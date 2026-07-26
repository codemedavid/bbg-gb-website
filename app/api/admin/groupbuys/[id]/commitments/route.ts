import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys, orderItems, orders, settlements, users } from '@/lib/db';
import { downpaymentState, finalPaymentState, orderBalance, packingFeeState } from '@/lib/settlement';

// Admin: who is in this hatian and what each of them still owes.
//
// One row per participant commitment, carrying the three payments separately —
// the reservation downpayment, the balance settled at the final checkout, and
// the packing fee that rides with it. Deferring the fee means "committed" no
// longer implies "paid for packing", so the admin needs to see them apart to
// chase the customers who have not settled.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();

  const rows = await db.select({
    orderId: orders.id,
    orderNo: orders.orderNo,
    orderStatus: orders.status,
    totalPhp: orders.totalPhp,
    downpaymentPhp: orders.downpaymentPhp,
    packingFeePhp: orders.packingFeePhp,
    settlementId: orders.settlementId,
    committedAt: orders.createdAt,
    customerName: users.name,
    customerEmail: users.email,
    customerPhone: users.phone,
    settlementStatus: settlements.status,
    settlementPaidAt: settlements.paidAt,
    hatianFeePhp: groupBuys.repackFeePhp,
    // Vials this participant claimed FROM THIS COUNTER. A commitment larger than
    // the counter's remaining vials is split across it and a freshly opened
    // sibling (app/api/orders/route.ts), so one order can hold lines against two
    // hatians — each counter reports only its own share.
    vials: sql<number>`sum(${orderItems.qty})::int`,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(users, eq(users.id, orders.userId))
    .innerJoin(groupBuys, eq(groupBuys.id, orderItems.groupBuyId))
    .leftJoin(settlements, eq(settlements.id, orders.settlementId))
    .where(eq(orderItems.groupBuyId, id))
    .groupBy(
      orders.id, orders.orderNo, orders.status, orders.totalPhp, orders.downpaymentPhp,
      orders.packingFeePhp, orders.settlementId, orders.createdAt,
      users.name, users.email, users.phone,
      settlements.status, settlements.paidAt, groupBuys.repackFeePhp,
    )
    .orderBy(orders.createdAt);

  // Which of these orders also claimed from another counter. An order balance is
  // a property of the whole order, so when a commitment overflowed into a sibling
  // the same figure appears under both hatians — the admin has to be told, or a
  // column total counts that money twice.
  const orderIds = rows.map((r) => r.orderId);
  const spanning = new Set(
    orderIds.length
      ? (await db.selectDistinct({ orderId: orderItems.orderId })
          .from(orderItems)
          .where(and(
            inArray(orderItems.orderId, orderIds),
            isNotNull(orderItems.groupBuyId),
            ne(orderItems.groupBuyId, id),
          ))).map((r) => r.orderId)
      : [],
  );

  return ok(rows.map((r) => {
    const order = {
      id: r.orderId,
      status: r.orderStatus,
      totalPhp: Number(r.totalPhp),
      downpaymentPhp: Number(r.downpaymentPhp),
      packingFeePhp: Number(r.packingFeePhp),
      hatianPackingFeePhp: Number(r.hatianFeePhp),
      settlementId: r.settlementId,
    };
    const settlementStatus = r.settlementStatus ?? null;
    return {
      orderId: r.orderId,
      orderNo: r.orderNo,
      orderStatus: r.orderStatus,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      customerPhone: r.customerPhone,
      vials: r.vials,
      committedAt: r.committedAt,
      // Named for what it is: the balance of the whole ORDER. When the order also
      // claimed from another counter the same figure appears there too, so it
      // must never be summed down the column without regard to the flag below.
      orderBalancePhp: orderBalance(order),
      spansOtherHatians: spanning.has(r.orderId),
      downpaymentPhp: order.downpaymentPhp,
      downpayment: downpaymentState(order),
      finalPayment: finalPaymentState(order, settlementStatus),
      packingFee: packingFeeState(order, settlementStatus),
      settledAt: r.settlementPaidAt,
    };
  }));
});
