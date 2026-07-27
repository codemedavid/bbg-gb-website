// Reading a customer's live kahati commitments out of the database.
//
// The rules that act on the result live in lib/kahati-commitment.ts; this file
// only decides which rows count as "live". Both the checkout route and the
// screen that previews it call through here, so the figure the customer is
// shown is produced by the same query that decides what they are charged.
import { and, asc, eq, ne } from 'drizzle-orm';
import { getDb, groupBuys, orderItems, orders } from '@/lib/db';
import type { KahatiCommitment } from './kahati-commitment';
import type { KahatiStatus } from './kahati';

type Db = Awaited<ReturnType<typeof getDb>>;

// Every kahati line the customer holds on an order that is still standing.
// Cancelled orders are excluded: a cancelled hatian refunds the downpayment, so
// that customer is no longer holding a place in the parcel.
export async function listKahatiCommitments(db: Db, userId: string): Promise<KahatiCommitment[]> {
  const rows = await db.select({
    orderId: orders.id,
    orderNo: orders.orderNo,
    kahatiId: groupBuys.id,
    kahatiName: groupBuys.name,
    kahatiStatus: groupBuys.status,
    qty: orderItems.qty,
    lineTotalPhp: orderItems.lineTotalPhp,
    placedAt: orders.createdAt,
  })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(groupBuys, eq(groupBuys.id, orderItems.groupBuyId))
    .where(and(
      eq(orders.userId, userId),
      eq(orderItems.kind, 'group_buy'),
      ne(orders.status, 'cancelled'),
    ))
    .orderBy(asc(orders.createdAt));

  return rows.map((r) => ({
    orderId: r.orderId,
    orderNo: r.orderNo,
    kahatiId: r.kahatiId,
    kahatiName: r.kahatiName,
    kahatiStatus: r.kahatiStatus as KahatiStatus,
    qty: r.qty,
    lineTotalPhp: Number(r.lineTotalPhp),
    placedAt: r.placedAt.toISOString(),
  }));
}
