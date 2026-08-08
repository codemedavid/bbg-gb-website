import { z } from 'zod';
import { and, desc, eq, gt, isNull, like, or, sql } from 'drizzle-orm';
import { getDb, orders, orderItems, orderPaymentProofs, orderStatusHistory, products, groupBuys, moqCampaigns, moqProducts, paymentMethods, settlements } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import {
  computeTotals, perVialPrice, round2,
  onHandUnitPrice, validateOnHandQty, validateMoqQty, vialsFor, VIALS_PER_KIT, type PriceableItem, type OnHandUnit,
} from '@/lib/pricing';
import { isKahatiFull } from '@/lib/kahati';
import { isChannelEnabled, channelRefusal } from '@/lib/product-channels';
import { closeFullKahati } from '@/lib/kahati-server';
import { listCyclePayments } from '@/lib/packing-cycle-server';
import { chargeCycleFeeOnce, hasPaidPackingFeeThisCycle } from '@/lib/packing-cycle';
import { canCommit } from '@/lib/group-buy';
import { BatchAllocationError, allocateCommitment, resolveOpenBatch, seriesOf } from '@/lib/moq-batch-server';
import { splitCartIntoOrders } from '@/lib/order-modes';
import { getCurrentCycle, getPackingFees } from '@/lib/settings';
import { cycleKeyOf } from '@/lib/schedule-recurrence';
import { requireCommitmentsOpen } from '@/lib/schedule-gate';
import { validateAndStoreProofs } from '@/lib/proof';
import { sendEmail, orderPlacedEmail } from '@/lib/email';
import { nextOrderNo } from '@/lib/order-number';
import { captureEvent } from '@/lib/posthog';
import { SHIPPING_OPTIONS, DEFAULT_COURIER } from '@/lib/report/constants';

const itemSchema = z.object({
  kind: z.enum(['product', 'group_buy', 'moq_campaign', 'moq_product']),
  refId: z.string().uuid(),
  qty: z.number().int().positive().max(9999),
  // On-hand lines only: 'piece' (single vial) or 'kit' (VIALS_PER_KIT vials).
  // Absent on kahati lines; defaults to 'piece' so older clients keep working.
  unit: z.enum(['piece', 'kit']).optional(),
});
const checkoutSchema = z.object({
  items: z.array(itemSchema).min(1),
  shipName: z.string().min(2).max(120),
  shipPhone: z.string().min(7).max(40),
  shipAddress: z.string().min(5).max(500),
  paymentMethod: z.string().min(1).max(40).optional(),
  // Free-text instructions the customer added in the cart. Bounded rather than
  // truncated: silently storing half a note reads as a complete instruction to
  // whoever packs the parcel, and nobody can tell afterwards that it was cut.
  // Whitespace-only collapses to absent, so a stray space is not "a note".
  note: z.string().trim().max(500).optional().transform((v) => v || undefined),
  // Customer-chosen shipping method; only the offered options are accepted.
  courier: z.enum(SHIPPING_OPTIONS).optional(),
  // Client-minted once per submission and reused on retries, so a resubmitted
  // checkout replays the original orders instead of creating duplicates.
  idempotencyKey: z.string().min(8).max(64).optional(),
});

// Checkout persists every purchasing mode: on-hand ('product'), kahati
// ('group_buy'), Group Buy campaigns ('moq_campaign') and the MOQ shelf
// ('moq_product'). This is the only route that takes payment — there is no
// second path a commitment can be paid for through.
type Priced = PriceableItem & {
  nameSnapshot: string;
  specSnapshot: string;
  // USD unit price snapshot for the weekly report; null when the line has no USD price.
  unitPriceUsd?: number | null;
  productId?: string;
  groupBuyId?: string;
  moqCampaignId?: string;
  moqProductId?: string;
};

export const POST = handler(async (req: Request) => {
  const session = await requireSession();
  const form = await req.formData();
  const body = checkoutSchema.parse({
    items: JSON.parse(String(form.get('items') ?? '[]')),
    shipName: form.get('shipName'),
    shipPhone: form.get('shipPhone'),
    shipAddress: form.get('shipAddress'),
    paymentMethod: form.get('paymentMethod') ?? undefined,
    courier: form.get('courier') ?? undefined,
    idempotencyKey: form.get('idempotencyKey') ?? undefined,
    note: form.get('note') ?? undefined,
  });

  const db = await getDb();

  // A retry of an already-successful submission replays the original orders —
  // no new rows, no new stock draws, no repeat emails.
  if (body.idempotencyKey) {
    const replayed = await findReplayedCheckout(db, session.sub, body.idempotencyKey);
    if (replayed) return ok(replayed, 201);
  }

  // Group Buy and Hatian only accept commitments while the shared window is
  // open. Checked before the proof is stored: a refused checkout must not leave
  // an uploaded object behind.
  //
  // A cart of purely on-hand stock is never gated — closing the boards must not
  // take ready stock down with it. A MIXED cart is refused whole rather than
  // part-filled: the customer uploaded proof for one total, and quietly dropping
  // the closed lines would charge them for a different order than the one they
  // reviewed. They remove the closed items and check out again.
  if (body.items.some((i) => i.kind === 'group_buy' || i.kind === 'moq_campaign')) {
    await requireCommitmentsOpen();
  }

  // The cycle those boards are trading in, resolved ONCE for this checkout.
  // Every order the cart splits into carries the same key, and asking again per
  // order could straddle a close — one half of a cart landing in this cycle and
  // the other in the next is exactly how a customer gets billed twice.
  const cycle = await getCurrentCycle();
  const cycleKey = cycle ? cycleKeyOf(cycle) : null;

  // Has this customer already paid to have this cycle's parcel packed? Read
  // before the transaction opens: it must reflect the orders that existed
  // BEFORE this checkout, never the one being placed.
  const paidThisCycle = hasPaidPackingFeeThisCycle(
    await listCyclePayments(db, session.sub, cycleKey),
  );
  // A cart that is nothing but hatian lines with the cycle fee already paid owes
  // nothing at all now, so there is no payment to prove. Any other cart — an
  // on-hand item alongside it, or the cycle's first commitment — is paid for at
  // checkout and must carry its proof.
  const confirmOnly = paidThisCycle && body.items.every((i) => i.kind === 'group_buy');

  // Every proof the customer attached — up to five, because a bank transfer cap
  // means one order is often paid across several transfers. Stored before the
  // transaction opens (external side effect); a rolled-back order leaves
  // harmless orphaned objects rather than a claimed slot.
  const proofKeys = confirmOnly ? [] : await validateAndStoreProofs(form.getAll('proof'));
  // Global packing-fee defaults; the on-hand fee has no per-listing home,
  // kahati items carry their own admin-editable fee (below).
  const packingFees = await getPackingFees();

  // Everything touching inventory runs in one transaction, so a failure part-way
  // through cannot leave claimed kahati slots or decremented stock behind.
  const placeOrders = () => db.transaction(async (tx) => {
    // Reject a payment method the customer could not actually have chosen.
    if (body.paymentMethod) {
      const [m] = await tx.select({ id: paymentMethods.id }).from(paymentMethods)
        .where(and(eq(paymentMethods.label, body.paymentMethod), eq(paymentMethods.isActive, true)));
      if (!m) throw new ApiError(400, 'Selected payment method is not available.');
    }

    // Re-price server-side; never trust client prices.
    const priced: Priced[] = [];
    for (const it of body.items) {
      if (it.kind === 'product') {
        const [p] = await tx.select().from(products).where(and(eq(products.id, it.refId), eq(products.isActive, true)));
        if (!p) throw new ApiError(400, `Product not available: ${it.refId}`);
        // The shop sells ready stock only — a catalog product whose On-Hand
        // switch is off cannot be bought here however its id arrived. Same
        // predicate and same wording as the Kahati guard below: one rule, three
        // channels, so a customer reading either refusal reads the same shape.
        if (!isChannelEnabled(p, 'on_hand')) throw new ApiError(400, channelRefusal(`${p.name} ${p.spec}`, 'on_hand'));

        const unit: OnHandUnit = it.unit ?? 'piece';
        const unitPricePhp = onHandUnitPrice(p, unit);
        if (unitPricePhp == null) {
          throw new ApiError(400, `${p.name} ${p.spec} is not sold by the ${unit}.`);
        }
        const check = validateOnHandQty(it.qty, unit, p.stock);
        if (!check.ok) throw new ApiError(400, `${p.name} ${p.spec}: ${check.message}`);

        // Draw the vials down inside the UPDATE. Like the kahati claim below, the
        // guard lives in the WHERE clause so two concurrent checkouts cannot both
        // pass a stale stock check and oversell.
        const vials = vialsFor(unit, it.qty);
        const [drawn] = await tx.update(products)
          .set({
            soldCount: sql`${products.soldCount} + ${vials}`,
            stock: sql`${products.stock} - ${vials}`,
          })
          .where(and(
            eq(products.id, p.id),
            eq(products.isActive, true),
            sql`${products.stock} >= ${vials}`,
          ))
          .returning({ stock: products.stock });
        if (!drawn) {
          const [fresh] = await tx.select({ stock: products.stock }).from(products).where(eq(products.id, p.id));
          throw new ApiError(400, `Only ${Math.max(fresh?.stock ?? 0, 0)} left in stock for ${p.name} ${p.spec}.`);
        }

        priced.push({
          kind: 'product',
          unitPricePhp,
          // The USD column prices a single vial; a kit line is worth a kit's worth.
          unitPriceUsd: p.priceUsd != null ? round2(Number(p.priceUsd) * vialsFor(unit, 1)) : null,
          qty: it.qty,
          packingFeePhp: packingFees.solo,
          nameSnapshot: `${p.name} ${p.spec}`,
          specSnapshot: unit === 'kit' ? `On-hand · kit of ${VIALS_PER_KIT}` : 'On-hand · per piece',
          productId: p.id,
        });
      } else if (it.kind === 'moq_product') {
        const [m] = await tx.select().from(moqProducts)
          .where(and(eq(moqProducts.id, it.refId), eq(moqProducts.isActive, true)));
        if (!m) throw new ApiError(400, `MOQ product not available: ${it.refId}`);

        // Re-check the admin-set minimum here: the client enforces it for the
        // sake of the UI, but only the server decides what may be bought.
        const check = validateMoqQty(it.qty, m.minOrderQty, m.stock);
        if (!check.ok) throw new ApiError(400, `${m.name}: ${check.message}`);

        // Guard lives in the WHERE clause so two concurrent checkouts cannot
        // both pass a stale stock read and oversell the shelf.
        const [drawn] = await tx.update(moqProducts)
          .set({ stock: sql`${moqProducts.stock} - ${it.qty}` })
          .where(and(
            eq(moqProducts.id, m.id),
            eq(moqProducts.isActive, true),
            sql`${moqProducts.stock} >= ${it.qty}`,
          ))
          .returning({ stock: moqProducts.stock });
        if (!drawn) {
          const [fresh] = await tx.select({ stock: moqProducts.stock })
            .from(moqProducts).where(eq(moqProducts.id, m.id));
          throw new ApiError(400, `Only ${Math.max(fresh?.stock ?? 0, 0)} left in stock for ${m.name}.`);
        }

        priced.push({
          kind: 'moq_product',
          unitPricePhp: round2(Number(m.pricePhp)),
          unitPriceUsd: m.priceUsd != null ? round2(Number(m.priceUsd)) : null,
          qty: it.qty,
          // Per-listing packing fee wins over the global MOQ default.
          packingFeePhp: m.packingFeePhp != null ? Number(m.packingFeePhp) : packingFees.moq,
          nameSnapshot: m.spec ? `${m.name} ${m.spec}` : m.name,
          specSnapshot: `MOQ · min ${m.minOrderQty}`,
          moqProductId: m.id,
        });
      } else if (it.kind === 'moq_campaign') {
        const [c] = await tx.select().from(moqCampaigns).where(eq(moqCampaigns.id, it.refId));
        if (!c) throw new ApiError(400, `Campaign not found: ${it.refId}`);

        // The client enforces the per-customer minimum for the sake of the UI,
        // but only the server decides what may be committed.
        if (!Number.isInteger(it.qty) || it.qty < c.perCustomerMin) {
          throw new ApiError(400, `${c.name}: minimum commitment is ${c.perCustomerMin} kit(s).`);
        }

        // A filled batch is full, not closed for business — the kits belong in
        // whichever batch of the series is open. Cancelled and approved
        // campaigns are genuinely finished and still refuse.
        const target = await resolveOpenBatch(tx, c);
        if (!canCommit(target.status) && target.status !== 'completed') {
          // Named by refId, not just by reason: the cart is persisted, so a line
          // the shop has stopped selling loops this same 400 on every retry and
          // takes the rest of the basket with it. staleCheckoutLine matches on
          // the id and the checkout page drops the line.
          throw new ApiError(400, `Group buy no longer accepting commitments: ${it.refId}`);
        }

        // Claim across batches. A commitment larger than the room left fills the
        // open batch, seals it, opens its successor and continues there — for as
        // many batches as it takes. Every claim is a guarded UPDATE, so racing
        // commitments can never push a batch past its cap. Running inside `tx`
        // means a failure anywhere in the cart releases these kits too.
        const fragments = await allocateCommitment(tx, target, it.qty)
          .catch((err) => {
            if (err instanceof BatchAllocationError) throw new ApiError(409, err.message);
            throw err;
          });

        const unitPrice = Number(c.pricePerKitPhp);
        // The listing's fee. Whether it is actually charged is decided once for
        // the whole cart by chargeCycleFeeOnce below — a cycle buys one parcel,
        // however many boards and batches the cart spans. Every fragment carries
        // the same figure: packingFeeFor bills a mode once, so a split batch is
        // still one fee.
        const packingFeePhp = Number(c.shippingPhp);

        for (const f of fragments) {
          priced.push({
            kind: 'moq_campaign',
            unitPricePhp: unitPrice,
            unitPriceUsd: null, // group buy kits are priced in PHP only
            qty: f.qty,
            packingFeePhp,
            nameSnapshot: `${f.batch.name} — group buy (Batch #${f.batch.batchNo})`,
            specSnapshot: `Group Buy · Batch #${f.batch.batchNo} · proceeds at MOQ or admin approval`,
            moqCampaignId: f.batch.id,
          });
        }
      } else {
        const [g] = await tx.select().from(groupBuys).where(eq(groupBuys.id, it.refId));
        if (!g) throw new ApiError(400, `Group buy not found: ${it.refId}`);
        if (g.status !== 'open') throw new ApiError(400, `Kahati "${g.name}" is already closed.`);

        // The Kahati switch, enforced where the money is taken. The board
        // already hides an off-channel product's counters, but hiding is not
        // enforcing: a counter id posted straight to this route, or a cart
        // persisted from before the switch was turned off, would otherwise
        // still buy vials of something that is no longer sold that way.
        //
        // Skipped for a counter with no product link — a free-text row an admin
        // made by hand has no product whose switches could refuse it.
        if (g.productId) {
          const [linked] = await tx
            .select({ isKahati: products.isKahati, isActive: products.isActive, name: products.name })
            .from(products).where(eq(products.id, g.productId));
          if (linked && !isChannelEnabled(linked, 'kahati')) {
            throw new ApiError(400, channelRefusal(linked.name, 'kahati'));
          }
        }
        // Validate the whole commitment up front. The 10-vial cap belongs to the
        // counter, not to the customer: overflow fills this counter, seals it,
        // and rolls into the sibling that opens — repeatedly, for as many kits as
        // the commitment needs. So there is no per-commitment ceiling here beyond
        // the schema's qty bound; only the group buy's admin-editable per-person
        // minimum applies.
        if (!Number.isInteger(it.qty) || it.qty < g.minVials) {
          throw new ApiError(400, `Minimum kahati commitment is ${g.minVials} vials.`);
        }

        // Claim across counters. Fill the current counter; when it caps, that
        // fill closes it and auto-opens a fresh sibling (the "reset" the client
        // asked for), and the remainder rolls into that sibling instead of being
        // rejected. The loop repeats for as many kits as the commitment spans, so
        // 25 vials seals three counters and leaves the fourth holding 2 — no
        // counter ever goes past 10. Each claim is guarded in its UPDATE, so
        // concurrent commits can never oversell a counter or push one past its
        // cap. Every fragment is the same (kahati) mode, so they check out under
        // a single packing fee — one fee per parcel, however many counters it spans.
        const now = new Date();
        let current = g;
        let remaining = it.qty;
        while (remaining > 0) {
          const openSlots = current.totalSlots - current.claimedSlots;
          // A full-but-still-open counter (e.g. an admin over-edit) has no room;
          // close it and roll straight into its sibling rather than claiming 0.
          if (openSlots <= 0) {
            const rolled = await closeFullKahati(tx, current);
            if (!rolled) throw new ApiError(409, `Kahati "${g.name}" just rolled over — please try again.`);
            current = rolled.opened;
            continue;
          }
          const take = Math.min(remaining, openSlots);
          const [claimed] = await tx.update(groupBuys)
            .set({ claimedSlots: sql`${groupBuys.claimedSlots} + ${take}` })
            .where(and(
              eq(groupBuys.id, current.id),
              eq(groupBuys.status, 'open'),
              or(isNull(groupBuys.closesAt), gt(groupBuys.closesAt, now)),
              sql`${groupBuys.claimedSlots} + ${take} <= ${groupBuys.totalSlots}`,
            ))
            .returning({ claimedSlots: groupBuys.claimedSlots });
          if (!claimed) {
            const [fresh] = await tx.select().from(groupBuys).where(eq(groupBuys.id, current.id));
            // Tell the customer what actually stopped them: a hatian past its
            // deadline (or no longer open) has closed — vials did not "run out".
            if (!fresh || fresh.status !== 'open' || (fresh.closesAt && fresh.closesAt <= now)) {
              throw new ApiError(400, `Kahati "${g.name}" has already closed and is no longer accepting commitments.`);
            }
            throw new ApiError(400, `Only ${Math.max(fresh.totalSlots - fresh.claimedSlots, 0)} vials left in this kahati.`);
          }

          priced.push({
            kind: 'group_buy',
            unitPricePhp: perVialPrice(Number(current.pricePerKitPhp)),
            unitPriceUsd: null, // kahati vials are priced in PHP only
            qty: take,
            // The hatian's own fee. chargeCycleFeeOnce decides whether it is
            // actually charged — one fee per cycle, across both boards.
            packingFeePhp: Number(current.repackFeePhp),
            nameSnapshot: `${current.name} — kahati`,
            specSnapshot: `Kahati · min ${current.minVials} vials`,
            groupBuyId: current.id,
          });

          remaining -= take;

          // Reaching the cap completes this kit: close the counter and auto-open
          // the sibling batch — inside the checkout transaction, shared with the
          // admin edit that fills a kit (lib/kahati-server.ts closeFullKahati).
          if (isKahatiFull(claimed.claimedSlots, current.totalSlots)) {
            const rolled = await closeFullKahati(tx, current);
            if (remaining > 0) {
              if (!rolled) throw new ApiError(409, `Kahati "${g.name}" just rolled over — please try again.`);
              current = rolled.opened; // place the overflow into the fresh sibling
            }
          }
        }
      }
    }

    // The three purchase modes never share an order: each has its own packing
    // fee and its own lifecycle (on-hand ships now, a hatian waits on its batch),
    // so a mixed cart becomes one order per mode. Splitting here rather than at
    // the call site keeps it inside the transaction — a failure in any mode rolls
    // back every order and every stock draw.
    // One packing fee for the whole cycle, decided across the cart before it is
    // split: each split order prices its own lines, so a cart spanning both
    // boards would otherwise pay one fee per board for a single parcel.
    const chargeable = chargeCycleFeeOnce(priced, paidThisCycle);

    const drafts = splitCartIntoOrders(chargeable);

    const created = [];
    for (const [splitIndex, draft] of drafts.entries()) {
      // splitCartIntoOrders preserves item identity, so each draft's items are the
      // same Priced objects and carry their snapshots through.
      const lines = draft.items as Priced[];
      const totals = draft.totals;
      // USD order total for the weekly report — sum of USD-priced lines only.
      const totalUsd = round2(lines.reduce((s, p) => s + (p.unitPriceUsd ?? 0) * p.qty, 0));

      // Every mode checks out here, so a draft's mode is always a buy type.
      const buyType = draft.mode;

      // The reference carries its system: KH- for a hatian, GB- for a group buy,
      // BBG- for on-hand and MOQ. Minted after the mode is known, from the one
      // shared sequence, so the two boards can never issue the same number.
      const orderNo = await nextOrderNo(tx, buyType);

      // A hatian pays only the packing fee now — the goods are settled once the
      // hatian ends — so what is due today IS the fee, added on top of the
      // products rather than taken out of them. Zero when the cycle's fee is
      // already paid, and zero for every other mode, which pays in full.
      const downpayment = buyType === 'kahati' ? totals.packingFee : 0;

      // Nothing was paid and no proof exists, so there is nothing for an admin
      // to verify — parking it in 'proof_review' would queue a review that can
      // never resolve. The commitment is simply confirmed.
      const status = confirmOnly ? 'payment_confirmed' : 'proof_review';

      const [order] = await tx.insert(orders).values({
        orderNo, userId: session.sub, status, buyType,
        subtotalPhp: String(totals.subtotal), packingFeePhp: String(totals.packingFee),
        totalPhp: String(totals.total), downpaymentPhp: String(downpayment), totalUsd: String(totalUsd),
        shipName: body.shipName, shipPhone: body.shipPhone, shipAddress: body.shipAddress,
        paymentMethod: body.paymentMethod ?? null,
        // Same chosen shipping method on every split order the cart produces.
        courier: body.courier ?? DEFAULT_COURIER,
        // The customer's note goes on EVERY order the cart splits into. One note
        // was written for one checkout; attaching it only to the first would
        // hide "pack these carefully" from whoever packs the other parcel.
        notes: body.note ?? null,
        // The first proof, kept in the original column so every existing reader
        // — the admin drawer, the customer's order page, the commitments export,
        // the reports — keeps working untouched. The full set lives in
        // order_payment_proofs below.
        paymentProofKey: proofKeys[0] ?? null,
        // Keyed per split index: one submission may legitimately create several
        // orders, but never the same one twice — the unique index enforces it.
        idempotencyKey: body.idempotencyKey ? `${body.idempotencyKey}:${splitIndex}` : null,
        // The trading cycle this order belongs to, for the boards that have
        // one. On-hand and MOQ orders are not gated by the schedule and ship as
        // their own parcels, so they belong to no cycle and must not be able to
        // satisfy a cycle's packing fee.
        cycleKey: buyType === 'kahati' || buyType === 'group_buy' ? cycleKey : null,
      }).returning();

      await tx.insert(orderItems).values(lines.map((p) => ({
        orderId: order.id, kind: p.kind, productId: p.productId ?? null, groupBuyId: p.groupBuyId ?? null,
        moqCampaignId: p.moqCampaignId ?? null, moqProductId: p.moqProductId ?? null,
        nameSnapshot: p.nameSnapshot, specSnapshot: p.specSnapshot,
        unitPricePhp: String(p.unitPricePhp), unitPriceUsd: p.unitPriceUsd != null ? String(p.unitPriceUsd) : null,
        qty: p.qty, lineTotalPhp: String(round2(p.unitPricePhp * p.qty)),
      })));
      // Every order this cart split into carries the same proofs: the customer
      // paid one total and evidenced it once, so an order left without them
      // would read as unpaid to the admin reviewing it.
      if (proofKeys.length) {
        await tx.insert(orderPaymentProofs).values(proofKeys.map((storageKey, i) => ({
          orderId: order.id, storageKey, sortOrder: i,
        })));
      }
      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        status,
        note: confirmOnly
          ? 'Order confirmed — no downpayment due, this customer already has a kahati commitment in progress'
          : 'Order placed',
      });

      created.push({ order, orderNo, totals, lineCount: lines.length });
    }

    // Inventory was already drawn down as each line was priced — on-hand stock in
    // the guarded UPDATE above, kahati slots in the guarded claim.
    return created;
  });

  let created: Awaited<ReturnType<typeof placeOrders>>;
  try {
    created = await placeOrders();
  } catch (err) {
    // Two racing submissions of the same checkout: the loser's transaction
    // rolls back (stock draws included) on the unique idempotency key. If the
    // winner's orders exist, this IS that race — replay them; anything else
    // is a genuine failure and propagates.
    if (body.idempotencyKey) {
      const replayed = await findReplayedCheckout(db, session.sub, body.idempotencyKey);
      if (replayed) return ok(replayed, 201);
    }
    throw err;
  }

  // Notify only after the transaction commits — never announce a rolled-back order.
  // One email and one event per order: a split cart produces orders with different
  // totals, downpayments and delivery timelines, so a single combined notice would
  // misstate what the customer owes on each.
  for (const { order, orderNo, totals, lineCount } of created) {
    await sendEmail({ to: session.email, ...orderPlacedEmail({ name: body.shipName, orderNo, total: totals.total, downpayment: Number(order.downpaymentPhp), confirmed: confirmOnly }), kind: 'order_placed' });
    await captureEvent({
      event: 'order_placed',
      distinctId: session.sub,
      email: session.email,
      name: body.shipName,
      properties: {
        orderId: order.id, orderNo, status: order.status, buyType: order.buyType,
        totalPhp: totals.total, subtotalPhp: totals.subtotal, packingFeePhp: totals.packingFee,
        downpaymentPhp: Number(order.downpaymentPhp),
        balancePhp: round2(totals.total - Number(order.downpaymentPhp)),
        itemCount: lineCount, paymentMethod: order.paymentMethod,
      },
    });
  }

  // `orders` carries every order created. The single-order fields alongside it
  // describe the first one, so the existing client redirect to /success/{orderNo}
  // keeps working while callers that care about a split can read the array.
  const [first] = created;
  return ok({
    orders: created,
    order: first.order,
    orderNo: first.orderNo,
    totals: first.totals,
  }, 201);
});

// Orders a previous submission with this idempotency key already created, in
// the same success-payload shape POST returns — so a retry (double tap, two
// tabs, refresh mid-submit) hands back the original order numbers instead of
// writing new rows. Returns null when the key has created nothing yet.
async function findReplayedCheckout(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  idempotencyKey: string,
) {
  const rows = await db.select().from(orders)
    .where(and(eq(orders.userId, userId), like(orders.idempotencyKey, `${idempotencyKey}:%`)))
    // ':0', ':1', … — split carts produce at most one order per mode, so the
    // lexicographic order matches the original creation order.
    .orderBy(orders.idempotencyKey);
  if (!rows.length) return null;

  const created = await Promise.all(rows.map(async (order) => {
    const lines = await db.select({ id: orderItems.id }).from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    return {
      order,
      orderNo: order.orderNo,
      totals: {
        subtotal: Number(order.subtotalPhp),
        packingFee: Number(order.packingFeePhp),
        total: Number(order.totalPhp),
      },
      lineCount: lines.length,
    };
  }));

  const [first] = created;
  return { orders: created, order: first.order, orderNo: first.orderNo, totals: first.totals };
}

export const GET = handler(async () => {
  const session = await requireSession();
  const db = await getDb();
  // The settlement's status rides along: My Orders has to tell an uploaded proof
  // apart from a verified payment, and the settlement id alone cannot.
  const rows = await db.select({ order: orders, settlementStatus: settlements.status })
    .from(orders)
    .leftJoin(settlements, eq(settlements.id, orders.settlementId))
    .where(eq(orders.userId, session.sub))
    .orderBy(desc(orders.createdAt));
  const withItems = await Promise.all(rows.map(async ({ order, settlementStatus }) => ({
    ...order,
    settlementStatus,
    items: await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
  })));
  return ok(withItems);
});
