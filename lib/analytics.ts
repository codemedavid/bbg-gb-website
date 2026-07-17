// Admin dashboard analytics: weekly/monthly order totals, weekly summary, fast-moving items.
import { and, desc, gte, sql, ne } from 'drizzle-orm';
import { getDb, orders, orderItems, products } from './db';

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
  const [totals, summary, fastMoving] = await Promise.all([orderTotals(), weeklySummary(), fastMovingItems()]);
  const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(sql`${orders.status} = 'proof_review'`);
  return { totals, weeklySummary: summary, fastMoving, pendingProofs: pending.count };
}
