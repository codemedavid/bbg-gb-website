// Admin dashboard analytics: order totals, packing fees, the day-by-day summary
// and fast-moving items — over the standing week/month/all-time periods, or over
// a calendar range the admin picked.
import { and, desc, eq, gte, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { getDb, orders, orderItems, products, settlements } from './db';
import { dateRangeBounds } from './report/week';
import type { StatsRange } from './analytics-range';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

/** Half-open UTC instants, as every window in here is expressed. */
type Window = { start: Date; end: Date };

const notCancelled = ne(orders.status, 'cancelled');
const placedWithin = (w: Window) => and(gte(orders.createdAt, w.start), lt(orders.createdAt, w.end));

const ORDER_AGGREGATE = {
  count: sql<number>`count(*)::int`,
  revenue: sql<number>`coalesce(sum(${orders.totalPhp}), 0)::float`,
};

async function ordersWhere(where: SQL | undefined): Promise<{ count: number; revenue: number }> {
  const db = await getDb();
  const [row] = await db.select(ORDER_AGGREGATE).from(orders).where(where);
  return row;
}

export async function orderTotals() {
  const [week, month, all] = await Promise.all([
    ordersWhere(and(gte(orders.createdAt, daysAgo(7)), notCancelled)),
    ordersWhere(and(gte(orders.createdAt, daysAgo(30)), notCancelled)),
    ordersWhere(notCancelled),
  ]);
  return { week, month, all };
}

type FeeTotals = { week: number; month: number; all: number };

// Packing fees have two legitimate homes. Immediate-checkout modes keep the
// charge on orders; deferred Hatian checkouts keep one charge on settlements.
// An order linked to an active settlement must not contribute its legacy fee as
// well, otherwise the dashboard would count the same parcel twice.
const chargeableOrderFee = and(
  notCancelled,
  or(isNull(orders.settlementId), eq(settlements.status, 'cancelled')),
);
const chargeableSettlementFee = ne(settlements.status, 'cancelled');

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
    .where(chargeableOrderFee);

  const [settlementFees] = await db.select(feeColumns(settlements.createdAt, settlements.packingFeePhp, weekStart, monthStart))
    .from(settlements)
    .where(chargeableSettlementFee);

  return {
    week: orderFees.week + settlementFees.week,
    month: orderFees.month + settlementFees.month,
    all: orderFees.all + settlementFees.all,
  };
}

/** The same two fee homes, narrowed to one window instead of the standing periods. */
export async function packingFeesIn(w: Window): Promise<number> {
  const db = await getDb();
  const sum = { total: sql<number>`coalesce(sum(${orders.packingFeePhp}), 0)::float` };

  const [orderFees] = await db.select(sum)
    .from(orders)
    .leftJoin(settlements, eq(orders.settlementId, settlements.id))
    .where(and(chargeableOrderFee, placedWithin(w)));

  const [settlementFees] = await db
    .select({ total: sql<number>`coalesce(sum(${settlements.packingFeePhp}), 0)::float` })
    .from(settlements)
    .where(and(
      chargeableSettlementFee,
      gte(settlements.createdAt, w.start),
      lt(settlements.createdAt, w.end),
    ));

  return orderFees.total + settlementFees.total;
}

// Per-day order count + revenue, for the summary chart. Defaults to the last 7
// days, which is what the unfiltered dashboard shows.
export async function dailySummary(w?: Window) {
  const db = await getDb();
  const period = w ? placedWithin(w) : gte(orders.createdAt, daysAgo(7));
  return db.select({
    day: sql<string>`to_char(date_trunc('day', ${orders.createdAt}), 'YYYY-MM-DD')`,
    count: sql<number>`count(*)::int`,
    revenue: sql<number>`coalesce(sum(${orders.totalPhp}), 0)::float`,
  }).from(orders)
    .where(and(period, notCancelled))
    .groupBy(sql`date_trunc('day', ${orders.createdAt})`)
    .orderBy(sql`date_trunc('day', ${orders.createdAt})`);
}

// Fast-moving items — top products by units sold. Defaults to the last 30 days,
// falling back to lifetime catalog leaders so a shop with no orders yet still
// has something to show. A chosen range gets no such fallback: "nothing sold
// between these dates" is the answer, and lifetime leaders would contradict it.
export async function fastMovingItems(limit = 8, w?: Window) {
  const db = await getDb();
  const period = w ? placedWithin(w) : gte(orders.createdAt, daysAgo(30));
  const recent = await db.select({
    productId: orderItems.productId,
    name: orderItems.nameSnapshot,
    unitsSold: sql<number>`sum(${orderItems.qty})::int`,
    revenue: sql<number>`coalesce(sum(${orderItems.lineTotalPhp}), 0)::float`,
  }).from(orderItems)
    .innerJoin(orders, sql`${orders.id} = ${orderItems.orderId}`)
    .where(and(period, notCancelled))
    .groupBy(orderItems.productId, orderItems.nameSnapshot)
    .orderBy(desc(sql`sum(${orderItems.qty})`))
    .limit(limit);

  if (recent.length > 0 || w) return recent;

  return db.select({
    productId: products.id, name: sql<string>`${products.name} || ' ' || ${products.spec}`,
    unitsSold: products.soldCount, revenue: sql<number>`(${products.soldCount} * ${products.pricePhp})::float`,
  }).from(products).orderBy(desc(products.soldCount)).limit(limit);
}

/**
 * Everything the dashboard renders.
 *
 * With a `range`, the period-scoped figures — totals.range, packingFees.range,
 * the day-by-day summary and the fast movers — narrow to those calendar days.
 * The lifetime totals and the pending-proof queue deliberately do not: one is
 * the context the range is read against, the other is a live work queue that
 * has no period at all.
 */
export async function dashboardStats(range?: StatsRange) {
  const db = await getDb();
  const window = range ? dateRangeBounds(range.from, range.to) : undefined;

  const [totals, packingFees, summary, fastMoving, rangeTotals, rangeFees] = await Promise.all([
    orderTotals(),
    packingFeeTotals(),
    dailySummary(window),
    fastMovingItems(8, window),
    window ? ordersWhere(and(placedWithin(window), notCancelled)) : undefined,
    window ? packingFeesIn(window) : undefined,
  ]);

  const [pending] = await db.select({ count: sql<number>`count(*)::int` })
    .from(orders).where(sql`${orders.status} = 'proof_review'`);

  return {
    totals: { ...totals, range: rangeTotals },
    packingFees: { ...packingFees, range: rangeFees },
    dailySummary: summary,
    fastMoving,
    pendingProofs: pending.count,
    range: range ?? null,
  };
}
