import { eq } from 'drizzle-orm';
import { getDb, moqCampaigns, orders, orderItems, orderStatusHistory } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { computeTotals, validateGroupBuyCommit, round2, type PriceableItem } from '@/lib/pricing';
import { canCommit } from '@/lib/group-buy';
import { BatchAllocationError, allocateCommitment, findOpenBatch, seriesOf } from '@/lib/moq-batch-server';
import { campaignCommitSchema } from '@/lib/moq-schemas';
import { validateAndStoreProof } from '@/lib/proof';
import { nextOrderNo } from '@/lib/order-number';

type Ctx = { params: Promise<{ id: string }> };

// Customer: commit `qty` kits to a Group Buy (MOQ) campaign. The commitment is
// held as a group_buy order (with a required payment proof).
//
// A batch caps at 10 kits, so a commitment larger than the room left is split
// across batches: the open one fills and completes, its successor opens, and the
// remainder continues there — for as many batches as the order needs. Every
// claim is a guarded UPDATE (lib/moq-batch-server.ts), so a concurrent
// cancel/approve cannot slip a commitment past a closed batch and two customers
// racing the last slots cannot push one past its cap.
//
// The split is a batching detail, not a billing one: however many batches the
// kits land in, the customer gets ONE order carrying one line per batch and a
// single packing fee.
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const form = await req.formData();
  const b = campaignCommitSchema.parse({
    qty: Number(form.get('qty')),
    shipName: form.get('shipName'),
    shipPhone: form.get('shipPhone'),
    shipAddress: form.get('shipAddress'),
  });

  // Store the proof before opening the transaction — external side effect; a
  // rolled-back order leaves a harmless orphaned object.
  const proofKey = await validateAndStoreProof(form.get('proof'));

  const { order, totals } = await (await getDb()).transaction(async (tx) => {
    const [c] = await tx.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
    if (!c) throw new ApiError(404, 'Campaign not found.');

    const check = validateGroupBuyCommit(b.qty);
    if (!check.ok) throw new ApiError(400, check.message!);

    // A completed batch is full, not closed for business: the commitment belongs
    // in whichever batch of the series is open, and if the fill never opened one
    // (a legacy row, an admin edit) allocation opens it. Cancelled and approved
    // campaigns are genuinely finished and still refuse.
    const target = c.status === 'completed' ? (await findOpenBatch(tx, seriesOf(c)) ?? c) : c;
    if (!canCommit(target.status) && target.status !== 'completed') {
      throw new ApiError(400, `This campaign is ${target.status} and no longer accepting commitments.`);
    }

    // A commitment that cannot be placed is a lost race, not a client error:
    // report it as a conflict the customer can retry rather than a 500.
    const fragments = await allocateCommitment(tx, target, b.qty)
      .catch((err) => {
        if (err instanceof BatchAllocationError) throw new ApiError(409, err.message);
        throw err;
      });

    const unitPrice = Number(c.pricePerKitPhp);
    // Each fragment prices as its own line, but they share one packing fee:
    // computeTotals charges a mode once per parcel, and a split batch is still
    // one parcel. c.shippingPhp is this campaign's pasabay packing fee.
    const priced: PriceableItem[] = fragments.map((f) => ({
      kind: 'moq_campaign', unitPricePhp: unitPrice, qty: f.qty, packingFeePhp: Number(c.shippingPhp),
    }));
    const totals = computeTotals(priced);
    const orderNo = await nextOrderNo(tx);

    const [order] = await tx.insert(orders).values({
      orderNo, userId: session.sub, status: 'proof_review', buyType: 'group_buy',
      subtotalPhp: String(totals.subtotal), packingFeePhp: String(totals.packingFee),
      totalPhp: String(totals.total),
      shipName: b.shipName, shipPhone: b.shipPhone, shipAddress: b.shipAddress,
      paymentProofKey: proofKey,
    }).returning();

    // One line per batch, each pointing at the batch that actually holds those
    // kits — which is what lets a completed batch still be reported on, and what
    // keeps a split commitment traceable on both sides.
    await tx.insert(orderItems).values(fragments.map((f) => ({
      orderId: order.id, kind: 'moq_campaign' as const, moqCampaignId: f.batch.id,
      nameSnapshot: `${f.batch.name} — group buy (Batch #${f.batch.batchNo})`,
      specSnapshot: `Group Buy · Batch #${f.batch.batchNo} · proceeds at MOQ or admin approval`,
      unitPricePhp: String(unitPrice), qty: f.qty, lineTotalPhp: String(round2(unitPrice * f.qty)),
    })));

    const spread = fragments.length > 1
      ? ` (split across ${fragments.length} batches: ${fragments.map((f) => `#${f.batch.batchNo}×${f.qty}`).join(', ')})`
      : ` (Batch #${fragments[0].batch.batchNo})`;
    await tx.insert(orderStatusHistory).values({
      orderId: order.id, status: 'proof_review', note: `Group buy commitment placed${spread}`,
    });

    return { order, totals };
  });

  return ok({ order, totals }, 201);
});
