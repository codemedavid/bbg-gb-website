// Hatian (kahati) lifecycle — database side effects.
//
// There is no scheduler in this app, so expired counters are resolved lazily:
// callers invoke sweepExpiredKahatis() when they read the board (public + admin).
// The auto-open on fill happens inside the checkout transaction (see the orders route).
//
// A hatian succeeds at KAHATI_MIN_VIABLE_VIALS (7), not at the 10-vial cap. An
// expired hatian at or above the minimum simply closes. Below it, the batch is
// never ordered, so every participant's order is cancelled, any on-hand stock in
// that order is returned, and the customer is emailed about their refund.
import { and, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { getDb, groupBuys, orders, orderItems, orderStatusHistory, products, users } from '@/lib/db';
import { KAHATI_MIN_VIABLE_VIALS, resolveExpiredKahatiStatus } from './kahati';
import { VIALS_PER_KIT } from './pricing';
import { sendEmail, kahatiCancelledEmail } from './email';

type Db = Awaited<ReturnType<typeof getDb>>;
type GroupBuyRow = typeof groupBuys.$inferSelect;

export type KahatiSweepResult = {
  closed: string[];      // hatian ids that met the minimum
  cancelled: string[];   // hatian ids that fell short
  ordersCancelled: number;
};

type CancellationNotice = {
  name: string; email: string; orderNo: string;
  kahatiName: string; claimedSlots: number; downpayment: number;
};

// Vials an on-hand line drew from stock. The unit is not its own column — the
// checkout route encodes it in the spec snapshot ("On-hand · kit of 10" vs
// "On-hand · per piece") — so restocking has to read it back from there.
export function vialsForOrderLine(specSnapshot: string | null, qty: number): number {
  return /\bkit\b/i.test(specSnapshot ?? '') ? qty * VIALS_PER_KIT : qty;
}

// Resolve OPEN hatians whose close deadline has passed. Idempotent: only rows
// still 'open' with an elapsed deadline are touched, and the participant release
// skips orders that are already cancelled.
export async function sweepExpiredKahatis(db: Db, now: Date = new Date()): Promise<KahatiSweepResult> {
  const expired = await db.select().from(groupBuys).where(and(
    eq(groupBuys.status, 'open'),
    isNotNull(groupBuys.closesAt),
    lt(groupBuys.closesAt, now),
  ));
  if (expired.length === 0) return { closed: [], cancelled: [], ordersCancelled: 0 };

  const closed = expired.filter((g) => resolveExpiredKahatiStatus(g.claimedSlots) === 'closed');
  const cancelled = expired.filter((g) => resolveExpiredKahatiStatus(g.claimedSlots) === 'cancelled');

  if (closed.length) {
    await db.update(groupBuys).set({ status: 'closed' })
      .where(inArray(groupBuys.id, closed.map((g) => g.id)));
  }

  const notices: CancellationNotice[] = [];
  for (const g of cancelled) {
    await db.update(groupBuys).set({ status: 'cancelled' }).where(eq(groupBuys.id, g.id));
    notices.push(...await releaseKahatiOrders(db, g));
  }

  // Email only after the database work is settled — never notify about a
  // cancellation that then fails to persist.
  for (const notice of notices) {
    await sendEmail({
      to: notice.email,
      ...kahatiCancelledEmail({ ...notice, minVials: KAHATI_MIN_VIABLE_VIALS }),
      kind: 'kahati_cancelled',
    });
  }

  return {
    closed: closed.map((g) => g.id),
    cancelled: cancelled.map((g) => g.id),
    ordersCancelled: notices.length,
  };
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
        name: customer.name, email: customer.email, orderNo: order.orderNo,
        kahatiName: g.name, claimedSlots: g.claimedSlots,
        downpayment: Number(order.downpaymentPhp),
      });
    }
  }
  return notices;
}
