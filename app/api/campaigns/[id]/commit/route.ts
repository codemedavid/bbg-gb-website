import { and, eq, sql } from 'drizzle-orm';
import { getDb, moqCampaigns, orders, orderItems, orderStatusHistory } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { computeTotals, validateGroupBuyCommit, round2 } from '@/lib/pricing';
import { canCommit } from '@/lib/group-buy';
import { campaignCommitSchema } from '@/lib/moq-schemas';
import { nextOrderNo } from '@/lib/order-number';

type Ctx = { params: Promise<{ id: string }> };

// Customer: commit `qty` kits to a Group Buy (MOQ) campaign. The commitment is
// held as a group_buy order; the campaign's committed counter is incremented
// atomically under a status='open' guard so a concurrent cancel/approve can't
// slip a commitment past a closed campaign.
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const b = campaignCommitSchema.parse(await req.json());

  const { order, totals } = await (await getDb()).transaction(async (tx) => {
    const [c] = await tx.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
    if (!c) throw new ApiError(404, 'Campaign not found.');
    if (!canCommit(c.status)) throw new ApiError(400, `This campaign is ${c.status} and no longer accepting commitments.`);

    const check = validateGroupBuyCommit(b.qty, c.perCustomerMin);
    if (!check.ok) throw new ApiError(400, check.message!);

    // Atomic increment; the status guard lives in the UPDATE so a race with an
    // approve/cancel can't record a commitment against a closed campaign.
    const [bumped] = await tx.update(moqCampaigns)
      .set({ committed: sql`${moqCampaigns.committed} + ${b.qty}` })
      .where(and(eq(moqCampaigns.id, id), eq(moqCampaigns.status, 'open')))
      .returning({ committed: moqCampaigns.committed });
    if (!bumped) throw new ApiError(400, 'This campaign is no longer accepting commitments.');

    const unitPrice = Number(c.pricePerKitPhp);
    const totals = computeTotals([{
      kind: 'moq_campaign', unitPricePhp: unitPrice, qty: b.qty, shippingPhp: Number(c.shippingPhp),
    }]);
    const orderNo = await nextOrderNo(tx);

    const [order] = await tx.insert(orders).values({
      orderNo, userId: session.sub, status: 'proof_review', buyType: 'group_buy',
      subtotalPhp: String(totals.subtotal), shippingPhp: String(totals.shipping),
      repackFeePhp: String(totals.repackFee), totalPhp: String(totals.total),
      shipName: b.shipName, shipPhone: b.shipPhone, shipAddress: b.shipAddress,
    }).returning();

    await tx.insert(orderItems).values({
      orderId: order.id, kind: 'moq_campaign', moqCampaignId: c.id,
      nameSnapshot: `${c.name} — group buy`, specSnapshot: 'Group Buy · proceeds at MOQ or admin approval',
      unitPricePhp: String(unitPrice), qty: b.qty, lineTotalPhp: String(round2(unitPrice * b.qty)),
    });
    await tx.insert(orderStatusHistory).values({ orderId: order.id, status: 'proof_review', note: 'Group buy commitment placed' });

    return { order, totals };
  });

  return ok({ order, totals }, 201);
});
