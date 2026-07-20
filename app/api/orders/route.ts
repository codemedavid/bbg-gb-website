import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, orders, orderItems, orderStatusHistory, products, groupBuys, paymentMethods } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import {
  computeTotals, perVialPrice, splitKahatiDownpayment, validateKahatiCommit, round2,
  onHandUnitPrice, validateOnHandQty, vialsFor, VIALS_PER_KIT, type PriceableItem, type OnHandUnit,
} from '@/lib/pricing';
import { isKahatiFull, nextKahatiClosesAt } from '@/lib/kahati';
import { splitCartIntoOrders } from '@/lib/order-modes';
import { getKahatiDownpayment, getPackingFees } from '@/lib/settings';
import { validateAndStoreProof } from '@/lib/proof';
import { sendEmail, orderPlacedEmail } from '@/lib/email';
import { nextOrderNo } from '@/lib/order-number';
import { captureEvent } from '@/lib/posthog';

const itemSchema = z.object({
  kind: z.enum(['product', 'group_buy']),
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
});

// Persistence layer supports only on-hand ('product') and kahati ('group_buy') line
// items today; the Group Buy (MOQ) mode is not yet wired into checkout, so Priced
// narrows PriceableItem's kind to the order_item_kind enum's current values.
type Priced = Omit<PriceableItem, 'kind'> & {
  kind: 'product' | 'group_buy';
  nameSnapshot: string;
  specSnapshot: string;
  // USD unit price snapshot for the weekly report; null when the line has no USD price.
  unitPriceUsd?: number | null;
  productId?: string;
  groupBuyId?: string;
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
  });

  // Store the proof before opening the transaction — it is an external side effect.
  // A rolled-back order leaves an orphaned object, which is harmless.
  const proofKey = await validateAndStoreProof(form.get('proof'));

  const db = await getDb();
  // Global packing-fee defaults; the on-hand fee has no per-listing home,
  // kahati items carry their own admin-editable fee (below).
  const packingFees = await getPackingFees();
  // Kahati reservation downpayment (admin-editable). Deducted from the total —
  // the customer pays this now and settles the balance after the kahati ends.
  const kahatiDownpaymentSetting = await getKahatiDownpayment();

  // Everything touching inventory runs in one transaction, so a failure part-way
  // through cannot leave claimed kahati slots or decremented stock behind.
  const created = await db.transaction(async (tx) => {
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
        // The shop sells ready stock only — a catalog product that is not flagged
        // on-hand has no on-hand price and cannot be bought here.
        if (!p.isOnHand) throw new ApiError(400, `${p.name} ${p.spec} is not available on-hand.`);

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
      } else {
        const [g] = await tx.select().from(groupBuys).where(eq(groupBuys.id, it.refId));
        if (!g) throw new ApiError(400, `Group buy not found: ${it.refId}`);
        if (g.status !== 'open') throw new ApiError(400, `Kahati "${g.name}" is already closed.`);
        // Honour this group buy's admin-editable minimum, not just the global default.
        const check = validateKahatiCommit(it.qty, g.totalSlots - g.claimedSlots, g.minVials);
        if (!check.ok) throw new ApiError(400, check.message!);

        // Claim the slots atomically. The guard lives in the UPDATE itself, so two
        // concurrent commits cannot both pass a stale remaining-slots check and oversell.
        const [claimed] = await tx.update(groupBuys)
          .set({ claimedSlots: sql`${groupBuys.claimedSlots} + ${it.qty}` })
          .where(and(
            eq(groupBuys.id, g.id),
            eq(groupBuys.status, 'open'),
            sql`${groupBuys.claimedSlots} + ${it.qty} <= ${groupBuys.totalSlots}`,
          ))
          .returning({ claimedSlots: groupBuys.claimedSlots });
        if (!claimed) {
          const [fresh] = await tx.select({ remaining: sql<number>`${groupBuys.totalSlots} - ${groupBuys.claimedSlots}` })
            .from(groupBuys).where(eq(groupBuys.id, g.id));
          throw new ApiError(400, `Only ${Math.max(fresh?.remaining ?? 0, 0)} vials left in this kahati.`);
        }

        // Reaching the cap completes this kit: close the counter and auto-open a
        // fresh sibling that inherits the product, price, cap, min, packing fee,
        // arrival group and deadline window. All inside the checkout transaction.
        if (isKahatiFull(claimed.claimedSlots, g.totalSlots)) {
          await tx.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, g.id));
          await tx.insert(groupBuys).values({
            name: g.name, pricePerKitPhp: g.pricePerKitPhp, totalSlots: g.totalSlots,
            claimedSlots: 0, minVials: g.minVials, repackFeePhp: g.repackFeePhp,
            status: 'open', arrivalGroup: g.arrivalGroup, description: g.description,
            closesAt: nextKahatiClosesAt(g.createdAt, g.closesAt, new Date()),
          });
        }

        priced.push({
          kind: 'group_buy',
          unitPricePhp: perVialPrice(Number(g.pricePerKitPhp)),
          unitPriceUsd: null, // kahati vials are priced in PHP only
          qty: it.qty,
          packingFeePhp: Number(g.repackFeePhp), // kahati packing fee, admin-editable per group buy
          nameSnapshot: `${g.name} — kahati`,
          specSnapshot: `Kahati · min ${g.minVials} vials`,
          groupBuyId: g.id,
        });
      }
    }

    // The three purchase modes never share an order: each has its own packing
    // fee and its own lifecycle (on-hand ships now, a hatian waits on its batch),
    // so a mixed cart becomes one order per mode. Splitting here rather than at
    // the call site keeps it inside the transaction — a failure in any mode rolls
    // back every order and every stock draw.
    const drafts = splitCartIntoOrders(priced);

    const created = [];
    for (const draft of drafts) {
      // splitCartIntoOrders preserves item identity, so each draft's items are the
      // same Priced objects and carry their snapshots through.
      const lines = draft.items as Priced[];
      const totals = draft.totals;
      // USD order total for the weekly report — sum of USD-priced lines only.
      const totalUsd = round2(lines.reduce((s, p) => s + (p.unitPriceUsd ?? 0) * p.qty, 0));
      const orderNo = await nextOrderNo(tx);

      // Checkout persists only on-hand and kahati lines today; the Group Buy (MOQ)
      // mode commits through /api/campaigns/:id/commit instead.
      const buyType = draft.mode as 'solo' | 'kahati';

      // Only kahati orders carry a reservation downpayment; on-hand pays in full.
      const downpayment = buyType === 'kahati'
        ? splitKahatiDownpayment(totals.total, kahatiDownpaymentSetting).downpayment
        : 0;

      const [order] = await tx.insert(orders).values({
        orderNo, userId: session.sub, status: 'proof_review', buyType,
        subtotalPhp: String(totals.subtotal), packingFeePhp: String(totals.packingFee),
        totalPhp: String(totals.total), downpaymentPhp: String(downpayment), totalUsd: String(totalUsd),
        shipName: body.shipName, shipPhone: body.shipPhone, shipAddress: body.shipAddress,
        paymentMethod: body.paymentMethod ?? null,
        // Each split order references the same proof — one payment covers the cart.
        paymentProofKey: proofKey,
      }).returning();

      await tx.insert(orderItems).values(lines.map((p) => ({
        orderId: order.id, kind: p.kind, productId: p.productId ?? null, groupBuyId: p.groupBuyId ?? null,
        nameSnapshot: p.nameSnapshot, specSnapshot: p.specSnapshot,
        unitPricePhp: String(p.unitPricePhp), unitPriceUsd: p.unitPriceUsd != null ? String(p.unitPriceUsd) : null,
        qty: p.qty, lineTotalPhp: String(round2(p.unitPricePhp * p.qty)),
      })));
      await tx.insert(orderStatusHistory).values({ orderId: order.id, status: 'proof_review', note: 'Order placed' });

      created.push({ order, orderNo, totals, lineCount: lines.length });
    }

    // Inventory was already drawn down as each line was priced — on-hand stock in
    // the guarded UPDATE above, kahati slots in the guarded claim.
    return created;
  });

  // Notify only after the transaction commits — never announce a rolled-back order.
  // One email and one event per order: a split cart produces orders with different
  // totals, downpayments and delivery timelines, so a single combined notice would
  // misstate what the customer owes on each.
  for (const { order, orderNo, totals, lineCount } of created) {
    await sendEmail({ to: session.email, ...orderPlacedEmail({ name: body.shipName, orderNo, total: totals.total, downpayment: Number(order.downpaymentPhp) }), kind: 'order_placed' });
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

export const GET = handler(async () => {
  const session = await requireSession();
  const db = await getDb();
  const rows = await db.select().from(orders).where(eq(orders.userId, session.sub)).orderBy(desc(orders.createdAt));
  const withItems = await Promise.all(rows.map(async (o) => ({
    ...o, items: await db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
  })));
  return ok(withItems);
});
