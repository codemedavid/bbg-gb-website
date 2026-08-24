// Admin dashboard analytics: weekly/monthly order totals, weekly summary, fast-moving items.
import { and, desc, eq, gte, isNull, ne, or, sql } from 'drizzle-orm';
import { getDb, orders, orderItems, products, settlements } from './db';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

export async function orderTotals() {
  const db = await getDb();
  const notCancelled = ne(orders.status, 'cancelled');
  const [week] = await db.select({
    count: sql<number>`count(*)::int`,
    revenue: sql<number>`coalesce(sum(${orders.totalPhp}), 0)::float`,
  }).from(orders).where(and(gte(orders.createdAt, daysAgo(7)), notCancelled));

  const [month] = await db.select({
    count: sql<number>`count(*)::int`,
    revenue: sql<number>`coalesce(sum(${orders.totalPhp}), 0)::float`,
  }).from(orders).where(and(gte(orders.createdAt, daysAgo(30)), notCancelled));

  const [all] = await db.select({
    count: sql<number>`count(*)::int`,
    revenue: sql<number>`coalesce(sum(${orders.totalPhp}), 0)::float`,
  }).from(orders).where(notCancelled);

  return { week, month, all };
}

type FeeTotals = { week: number; month: number; all: number };

// Packing fees have two legitimate homes. Immediate-checkout modes keep the
// charge on orders; deferred Hatian checkouts keep one charge on settlements.
// An order linked to an active settlement must not contribute its legacy fee as
// well, otherwise the dashboard would count the same parcel twice.
// The boundaries are bound as ISO strings with an explicit cast, never as Date
// objects. A Date handed to drizzle's comparison helpers (gte, lt) is mapped
// through the column it is compared against; one interpolated into a raw `sql`
// template has no column to be mapped through, and postgres-js — the driver
// behind every real deployment — then fails at Bind time with "The 'string'
// argument must be of type string ... Received an instance of Date". pglite
// accepts it, so this only ever surfaced in production. See analytics.test.ts.
export const feeColumns = <TCreated, TFee>(
  createdAt: TCreated, fee: TFee, weekStart: Date, monthStart: Date,
) => ({
  week: sql<number>`coalesce(sum(case when ${createdAt} >= ${weekStart.toISOString()}::timestamptz then ${fee} else 0 end), 0)::float`,
  month: sql<number>`coalesce(sum(case when ${createdAt} >= ${monthStart.toISOString()}::timestamptz then ${fee} else 0 end), 0)::float`,
  all: sql<number>`coalesce(sum(${fee}), 0)::float`,
});

export async function packingFeeTotals(): Promise<FeeTotals> {
  const db = await getDb();
  const weekStart = daysAgo(7);
  const monthStart = daysAgo(30);

  const [orderFees] = await db.select(feeColumns(orders.createdAt, orders.packingFeePhp, weekStart, monthStart))
    .from(orders)
    .leftJoin(settlements, eq(orders.settlementId, settlements.id))
    .where(and(
      ne(orders.status, 'cancelled'),
      or(isNull(orders.settlementId), eq(settlements.status, 'cancelled')),
    ));

  const [settlementFees] = await db.select(feeColumns(settlements.createdAt, settlements.packingFeePhp, weekStart, monthStart))
    .from(settlements)
    .where(ne(settlements.status, 'cancelled'));

  return {
    week: orderFees.week + settlementFees.week,
    month: orderFees.month + settlementFees.month,
    all: orderFees.all + settlementFees.all,
  };
}

// Per-day order count + revenue for the last 7 days (for the weekly summary chart).
export async function weeklySummary() {
  const db = await getDb();
  const rows = await db.select({
    day: sql<string>`to_char(date_trunc('day', ${orders.createdAt}), 'YYYY-MM-DD')`,
    count: sql<number>`count(*)::int`,
    revenue: sql<number>`coalesce(sum(${orders.totalPhp}), 0)::float`,
  }).from(orders)
    .where(and(gte(orders.createdAt, daysAgo(7)), ne(orders.status, 'cancelled')))
    .groupBy(sql`date_trunc('day', ${orders.createdAt})`)
    .orderBy(sql`date_trunc('day', ${orders.createdAt})`);
  return rows;
}

// Fast-moving items — top products by units sold in the last 30 days (fallback to soldCount).
export async function fastMovingItems(limit = 8) {
  const db = await getDb();
  const recent = await db.select({
    productId: orderItems.productId,
    name: orderItems.nameSnapshot,
    unitsSold: sql<number>`sum(${orderItems.qty})::int`,
    revenue: sql<number>`coalesce(sum(${orderItems.lineTotalPhp}), 0)::float`,
  }).from(orderItems)
    .innerJoin(orders, sql`${orders.id} = ${orderItems.orderId}`)
    .where(and(gte(orders.createdAt, daysAgo(30)), ne(orders.status, 'cancelled')))
    .groupBy(orderItems.productId, orderItems.nameSnapshot)
    .orderBy(desc(sql`sum(${orderItems.qty})`))
    .limit(limit);

  if (recent.length > 0) return recent;

  // Fallback: lifetime soldCount from the catalog (useful before live orders accrue).
  return db.select({
    productId: products.id, name: sql<string>`${products.name} || ' ' || ${products.spec}`,
    unitsSold: products.soldCount, revenue: sql<number>`(${products.soldCount} * ${products.pricePhp})::float`,
  }).from(products).orderBy(desc(products.soldCount)).limit(limit);
}

export async function dashboardStats() {
  const db = await getDb();
  const [totals, packingFees, summary, fastMoving] = await Promise.all([
    orderTotals(), packingFeeTotals(), weeklySummary(), fastMovingItems(),
  ]);
  const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(sql`${orders.status} = 'proof_review'`);
  return { totals, packingFees, weeklySummary: summary, fastMoving, pendingProofs: pending.count };
}
