// Hatian (kahati) lifecycle — database side effects.
//
// There is no scheduler in this app, so expired counters are resolved lazily:
// callers invoke sweepExpiredKahatis() when they read the board (public + admin).
// The auto-open on fill happens inside the checkout transaction (see the orders
// route) and on admin edits that fill the kit — both through closeFullKahati.
//
// A hatian succeeds at KAHATI_MIN_VIABLE_VIALS (7), not at the 10-vial cap. An
// expired hatian at or above the minimum simply closes. Below it, the batch is
// never ordered, so every participant's order is cancelled, any on-hand stock in
// that order is returned, and the customer is emailed about their refund. An
// admin cancelling a hatian outright runs the same release flow (cancelKahati).
import { and, eq, gte, isNotNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import { getDb, groupBuys, orders, orderItems, orderStatusHistory, products, users } from '@/lib/db';
import { KAHATI_MIN_VIABLE_VIALS, nextKahatiClosesAt } from './kahati';
import { VIALS_PER_KIT } from './pricing';
import { sendEmail, kahatiCancelledEmail } from './email';
import { captureEvent } from './posthog';

// A transaction handle exposes the same query surface as the root database, so
// helpers here accept either — checkout calls closeFullKahati inside its tx.
type Db = Awaited<ReturnType<typeof getDb>>;
type GroupBuyRow = typeof groupBuys.$inferSelect;

export type KahatiSweepResult = {
  closed: string[];      // hatian ids that met the minimum
  cancelled: string[];   // hatian ids that fell short
  ordersCancelled: number;
};

export type CancellationNotice = {
  userId: string; name: string; email: string; orderId: string; orderNo: string;
  kahatiId: string; kahatiName: string; claimedSlots: number; downpayment: number;
};

export type KahatiCancellation = { row: GroupBuyRow; notices: CancellationNotice[] };

// Vials an on-hand line drew from stock. The unit is not its own column — the
// checkout route encodes it in the spec snapshot ("On-hand · kit of 10" vs
// "On-hand · per piece") — so restocking has to read it back from there.
export function vialsForOrderLine(specSnapshot: string | null, qty: number): number {
  return /\bkit\b/i.test(specSnapshot ?? '') ? qty * VIALS_PER_KIT : qty;
}

// An open hatian whose deadline elapsed without reaching the minimum. Reused by
// the sweep's candidate read and by the guarded cancel transition, so the
// condition acted on is always the condition re-checked.
const expiredUnviable = (now: Date): SQL | undefined => and(
  eq(groupBuys.status, 'open'),
  isNotNull(groupBuys.closesAt),
  lt(groupBuys.closesAt, now),
  lt(groupBuys.claimedSlots, KAHATI_MIN_VIABLE_VIALS),
);

// Resolve OPEN hatians whose close deadline has passed. Both transitions are
// guarded conditional UPDATEs — the WHERE re-checks status, deadline and
// viability, and RETURNING decides which rows this sweep actually resolved. A
// checkout racing the sweep therefore cannot strand a fresh order on a
// cancelled hatian, and a hatian that just turned viable cannot be cancelled.
// Idempotent: a repeat sweep matches nothing and releases nobody.
export async function sweepExpiredKahatis(db: Db, now: Date = new Date()): Promise<KahatiSweepResult> {
  const closed = await db.update(groupBuys).set({ status: 'closed' })
    .where(and(
      eq(groupBuys.status, 'open'),
      isNotNull(groupBuys.closesAt),
      lt(groupBuys.closesAt, now),
      gte(groupBuys.claimedSlots, KAHATI_MIN_VIABLE_VIALS),
    ))
    .returning({ id: groupBuys.id });

  const candidates = await db.select({ id: groupBuys.id }).from(groupBuys)
    .where(expiredUnviable(now));

  const cancelled: string[] = [];
  const notices: CancellationNotice[] = [];
  for (const candidate of candidates) {
    const result = await cancelExpiredKahati(db, candidate.id, now);
    if (!result) continue; // lost the race: turned viable or already resolved
    cancelled.push(result.row.id);
    notices.push(...result.notices);
  }

  await notifyKahatiCancellations(notices);

  return {
    closed: closed.map((r) => r.id),
    cancelled,
    ordersCancelled: notices.length,
  };
}

// Guarded transition for the sweep: cancel this hatian only if it is still an
// expired, unviable, open counter. A stale decision — the row changed since it
// was read — flips nothing, releases nothing and returns null.
export async function cancelExpiredKahati(db: Db, id: string, now: Date): Promise<KahatiCancellation | null> {
  return flipToCancelled(db, id, expiredUnviable(now));
}

// Admin cancellation: an explicit cancel releases the participants whatever the
// counter's viability, guarded only against repeating an earlier cancel.
export async function cancelKahati(db: Db, id: string): Promise<KahatiCancellation | null> {
  return flipToCancelled(db, id, ne(groupBuys.status, 'cancelled'));
}

async function flipToCancelled(db: Db, id: string, guard: SQL | undefined): Promise<KahatiCancellation | null> {
  const [row] = await db.update(groupBuys).set({ status: 'cancelled' })
    .where(and(eq(groupBuys.id, id), guard))
    .returning();
  if (!row) return null;
  return { row, notices: await releaseKahatiOrders(db, row) };
}

// Email + analytics for a batch of cancellations. Called only after the
// database work is settled — never notify about a cancellation that then
// fails to persist.
export async function notifyKahatiCancellations(notices: CancellationNotice[]): Promise<void> {
  for (const notice of notices) {
    await sendEmail({
      to: notice.email,
      ...kahatiCancelledEmail({ ...notice, minVials: KAHATI_MIN_VIABLE_VIALS }),
      kind: 'kahati_cancelled',
    });
    // Distinct from order_cancelled: this one carries the refund amount and the
    // hatian that fell through, so PostHog can send the right explanation.
    await captureEvent({
      event: 'kahati_cancelled',
      distinctId: notice.userId,
      email: notice.email,
      name: notice.name,
      properties: {
        orderId: notice.orderId, orderNo: notice.orderNo, status: 'cancelled',
        kahatiId: notice.kahatiId, kahatiName: notice.kahatiName,
        claimedVials: notice.claimedSlots, minVials: KAHATI_MIN_VIABLE_VIALS,
        refundPhp: notice.downpayment,
      },
    });
  }
}

// Reaching the cap completes this kit: close the counter and auto-open a fresh
// sibling that inherits the product, price, cap, min, packing fee, arrival
// group and deadline window. The flip is guarded on 'open' so two callers
// racing the same fill can never clone two siblings; returns null for the
// caller that lost. Shared by the checkout transaction and the admin edit.
export async function closeFullKahati(db: Db, g: GroupBuyRow): Promise<GroupBuyRow | null> {
  const [sealed] = await db.update(groupBuys).set({ status: 'closed' })
    .where(and(eq(groupBuys.id, g.id), eq(groupBuys.status, 'open')))
    .returning();
  if (!sealed) return null;
  await db.insert(groupBuys).values({
    name: g.name, pricePerKitPhp: g.pricePerKitPhp, totalSlots: g.totalSlots,
    claimedSlots: 0, minVials: g.minVials, repackFeePhp: g.repackFeePhp,
    status: 'open', arrivalGroup: g.arrivalGroup, description: g.description,
    closesAt: nextKahatiClosesAt(g.createdAt, g.closesAt, new Date()),
  });
  return sealed;
}

// Cancels every live order holding a line on a failed hatian and returns the
// details needed to notify each customer.
async function releaseKahatiOrders(db: Db, g: GroupBuyRow): Promise<CancellationNotice[]> {
  const affected = await db.selectDistinct({
    id: orders.id, orderNo: orders.orderNo, userId: orders.userId, downpaymentPhp: orders.downpaymentPhp,
  })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(and(
      eq(orderItems.groupBuyId, g.id),
      // Already-cancelled orders are skipped, which is what makes a repeat sweep safe.
      ne(orders.status, 'cancelled'),
    ));

  const note = `Hatian "${g.name}" closed with ${g.claimedSlots} of ${KAHATI_MIN_VIABLE_VIALS} vials needed — batch cancelled.`;
  const notices: CancellationNotice[] = [];

  for (const order of affected) {
    await db.transaction(async (tx) => {
      // The whole order is cancelled, so any on-hand vials it drew go back to
      // stock rather than being silently lost.
      const onHandLines = await tx.select().from(orderItems)
        .where(and(eq(orderItems.orderId, order.id), eq(orderItems.kind, 'product')));
      for (const line of onHandLines) {
        if (!line.productId) continue;
        const vials = vialsForOrderLine(line.specSnapshot, line.qty);
        await tx.update(products).set({
          stock: sql`${products.stock} + ${vials}`,
          soldCount: sql`GREATEST(${products.soldCount} - ${vials}, 0)`,
        }).where(eq(products.id, line.productId));
      }

      await tx.update(orders).set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(orders.id, order.id));
      await tx.insert(orderStatusHistory).values({ orderId: order.id, status: 'cancelled', note });
    });

    const [customer] = await db.select({ name: users.name, email: users.email })
      .from(users).where(eq(users.id, order.userId));
    if (customer) {
      notices.push({
        userId: order.userId, name: customer.name, email: customer.email,
        orderId: order.id, orderNo: order.orderNo,
        kahatiId: g.id, kahatiName: g.name, claimedSlots: g.claimedSlots,
        downpayment: Number(order.downpaymentPhp),
      });
    }
  }
  return notices;
}
