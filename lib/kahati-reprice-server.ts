// Passing a lowered hatian price on to the vials already committed to it.
//
// A commitment snapshots the counter's per-vial price at checkout, which is
// right for everything except a correction. When an admin (or a catalog
// repricing) brings a counter's price DOWN, the customers already on it are
// still splitting the same kit as the customers who join next — and before this
// they kept paying the old figure. KH-2737 paid ₱630 a vial on a counter the
// next buyer joined at ₱450.
//
// The rule is one-directional on purpose: a price that falls reaches everyone
// on the counter; a price that rises never charges an earlier buyer more than
// they agreed to. Payment status is left alone — an order that was already paid
// simply ends up with a total below what it collected, which the admin's proof
// reconciliation reports as an overpayment to send back.
import { and, eq, gt, ne } from 'drizzle-orm';
import { getDb, orders, orderItems, orderStatusHistory } from '@/lib/db';
import { applyOrderItemEdit } from '@/lib/order-edit-server';
import { perVialPrice } from '@/lib/pricing';

type Db = Awaited<ReturnType<typeof getDb>>;

const peso = (n: number): string => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

/**
 * Reprice every live commitment on `counterId` that sits above the counter's
 * new per-vial price. Returns how many orders changed.
 *
 * Cancelled orders are history, not money owed, so they keep their figures.
 */
export async function passPriceDropToCommitments(
  db: Db,
  counterId: string,
  pricePerKitPhp: string | number,
): Promise<number> {
  const newVialPrice = perVialPrice(Number(pricePerKitPhp));

  const overpriced = await db
    .select({ line: orderItems })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      eq(orderItems.groupBuyId, counterId),
      gt(orderItems.unitPricePhp, String(newVialPrice)),
      ne(orders.status, 'cancelled'),
    ));
  if (!overpriced.length) return 0;

  const orderIds = [...new Set(overpriced.map(({ line }) => line.orderId))];
  for (const orderId of orderIds) {
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const repriced = overpriced.filter(({ line }) => line.orderId === orderId).map(({ line }) => line);
    const repricedIds = new Set(repriced.map((line) => line.id));

    // The complete line set, as applyOrderItemEdit requires: unchanged lines
    // restate what they already hold, so no quantity moves and no counter is
    // touched — only the prices and the order's totals are rewritten.
    const { order } = await applyOrderItemEdit(db, orderId, lines.map((line) => ({
      id: line.id,
      nameSnapshot: line.nameSnapshot,
      specSnapshot: line.specSnapshot,
      qty: line.qty,
      unitPricePhp: repricedIds.has(line.id) ? newVialPrice : Number(line.unitPricePhp),
    })));

    await db.insert(orderStatusHistory).values({
      orderId,
      status: order.status,
      note: repriced
        .map((line) => `Hatian price lowered — ${line.nameSnapshot}: ${peso(Number(line.unitPricePhp))} → ${peso(newVialPrice)} per vial`)
        .join('; '),
    });
  }
  return orderIds.length;
}
