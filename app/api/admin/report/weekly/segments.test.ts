// The weekly report, split into the two businesses it was reporting as one.
//
// The Product Totals sheet is what the batch order is sized from, and it used to
// carry on-hand sales alongside the vials still owed to the supplier. On-hand
// stock has already left the stockroom — counting it again toward the kits to
// order buys them twice.
//
// The split rule is a pure function (lib/report/segment.ts) but the columns it
// reads — orders.buy_type and order_items.kind — only reach it through this
// route's select. A route that forgets either one still returns a plausible
// report: right names, right money, everything filed under on-hand.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const admin = { sub: 'admin', role: 'admin', email: 'a@b.c' };
  return {
    ApiError,
    getSession: async () => admin,
    requireSession: async () => admin,
    requireAdmin: async () => admin,
  };
});

const { GET } = await import('./route');
const { getDb, products, groupBuys, orders, orderItems } = await import('@/lib/db');
const { resetDb, makeUser } = await import('@/lib/test/harness');

const MONDAY = '2026-03-16';
const IN_WEEK = new Date('2026-03-17T02:00:00Z');

type Half = {
  orderCount: number;
  rows: { invoice: string }[];
  totals: { usd: number; php: number };
  productTotals: { rows: { name: string; qty: number; kits: number }[]; totals: { qty: number } };
};

const fetchReport = async (): Promise<{
  report: Half;
  segments: { onhand: Half; groupbuy: Half };
}> => {
  const res = await GET(new Request(`http://localhost/api/admin/report/weekly?week=${MONDAY}`));
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data;
};

async function makeOrder(orderNo: string, buyType: 'solo' | 'kahati' | 'group_buy' | 'moq', totalPhp: string) {
  const db = await getDb();
  const user = await makeUser();
  const [order] = await db.insert(orders).values({
    orderNo, userId: user.id, status: 'payment_confirmed', buyType,
    subtotalPhp: totalPhp, totalPhp, totalUsd: '0',
    shipName: 'Gelly', shipPhone: '0917', shipAddress: 'Manila', createdAt: IN_WEEK,
  }).returning();
  return order;
}

/** An on-hand sale: a real product, drawn from stock, sold by the piece. */
async function seedOnHandOrder(orderNo = 'BBG-10001', qty = 5) {
  const db = await getDb();
  const order = await makeOrder(orderNo, 'solo', '1900');
  const [product] = await db.insert(products).values({
    name: 'Tirzepatide', spec: '15mg vial', code: 'TR15',
    pricePhp: '380', priceUsd: '6.80', kitSize: 10, stock: 50, isOnHand: true,
  }).returning();
  await db.insert(orderItems).values({
    orderId: order.id, kind: 'product', productId: product.id,
    nameSnapshot: 'Tirzepatide', specSnapshot: '15mg vial',
    unitPricePhp: '380', unitPriceUsd: '6.80', qty, lineTotalPhp: String(380 * qty),
  });
  return order;
}

/** A hatian commitment: vials against a counter, owed to the supplier. */
async function seedKahatiOrder(orderNo = 'BBG-10002', qty = 30) {
  const db = await getDb();
  const order = await makeOrder(orderNo, 'kahati', '27000');
  const [product] = await db.insert(products).values({
    name: 'Retatrutide', spec: '30mg vial', code: 'RT30',
    pricePhp: '900', kitSize: 10, stock: 0,
  }).returning();
  const [kahati] = await db.insert(groupBuys).values({
    name: 'Retatrutide', pricePerKitPhp: '9000', totalSlots: 10,
    claimedSlots: 0, minVials: 1, repackFeePhp: '150', status: 'open', productId: product.id,
  }).returning();
  await db.insert(orderItems).values({
    orderId: order.id, kind: 'group_buy', groupBuyId: kahati.id,
    nameSnapshot: 'Retatrutide — kahati', specSnapshot: 'per vial',
    unitPricePhp: '900', unitPriceUsd: null, qty, lineTotalPhp: String(900 * qty),
  });
  return order;
}

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/admin/report/weekly returns the week in two halves', () => {
  it('files an on-hand order and a hatian order on opposite sides', async () => {
    await seedOnHandOrder();
    await seedKahatiOrder();

    const { segments } = await fetchReport();

    expect(segments.onhand.rows.map((r) => r.invoice)).toEqual(['BBG-10001']);
    expect(segments.groupbuy.rows.map((r) => r.invoice)).toEqual(['BBG-10002']);
  });

  // The regression the split exists to prevent.
  it('keeps on-hand stock out of the batch-order rollup', async () => {
    await seedOnHandOrder();
    await seedKahatiOrder();

    const { segments } = await fetchReport();

    expect(segments.groupbuy.productTotals.rows.map((r) => r.name)).toEqual(['Retatrutide — kahati']);
    expect(segments.groupbuy.productTotals.totals.qty).toBe(30);
  });

  it('keeps pre-ordered vials out of the on-hand rollup', async () => {
    await seedOnHandOrder();
    await seedKahatiOrder();

    const { segments } = await fetchReport();

    expect(segments.onhand.productTotals.rows.map((r) => r.name)).toEqual(['Tirzepatide']);
    expect(segments.onhand.productTotals.totals.qty).toBe(5);
  });

  // The 10x over-count fixed in 71d1d57 is arithmetic done inside a half now;
  // this pins that it survived the move.
  it('still divides a hatian line by its supplier kit size within its half', async () => {
    await seedKahatiOrder('BBG-10003', 109);

    const [row] = (await fetchReport()).segments.groupbuy.productTotals.rows;

    expect(row.qty).toBe(109);
    expect(row.kits).toBeCloseTo(10.9, 5);
  });

  it('splits the money so each half stands on its own', async () => {
    await seedOnHandOrder();
    await seedKahatiOrder();

    const { segments } = await fetchReport();

    expect(segments.onhand.orderCount).toBe(1);
    expect(segments.onhand.totals.php).toBe(1900);
    expect(segments.groupbuy.orderCount).toBe(1);
    expect(segments.groupbuy.totals.php).toBe(27000);
  });

  it('leaves the other half empty rather than absent when a week is one-sided', async () => {
    await seedOnHandOrder();

    const { segments } = await fetchReport();

    expect(segments.groupbuy.rows).toEqual([]);
    expect(segments.groupbuy.orderCount).toBe(0);
    expect(segments.groupbuy.productTotals.rows).toEqual([]);
  });

  // orders.buy_type is NOT NULL with a 'solo' default, so a row written before
  // checkout populated it looks like an on-hand sale. Its lines do not.
  it('files a legacy order with a defaulted buy type by its line kinds', async () => {
    const db = await getDb();
    const order = await makeOrder('BBG-10009', 'solo', '4500');
    const [kahati] = await db.insert(groupBuys).values({
      name: 'Semaglutide', pricePerKitPhp: '9000', totalSlots: 10,
      claimedSlots: 0, minVials: 1, repackFeePhp: '150', status: 'open',
    }).returning();
    await db.insert(orderItems).values({
      orderId: order.id, kind: 'group_buy', groupBuyId: kahati.id,
      nameSnapshot: 'Semaglutide — kahati', specSnapshot: 'per vial',
      unitPricePhp: '900', unitPriceUsd: null, qty: 5, lineTotalPhp: '4500',
    });

    const { segments } = await fetchReport();

    expect(segments.groupbuy.rows.map((r) => r.invoice)).toEqual(['BBG-10009']);
    expect(segments.onhand.rows).toEqual([]);
  });
});

describe('the combined report stays available alongside the halves', () => {
  // The on-page view and the exports read `segments`, but nothing that already
  // consumed `report` should have to change to keep working.
  it('still returns the whole week under `report`', async () => {
    await seedOnHandOrder();
    await seedKahatiOrder();

    const { report } = await fetchReport();

    expect(report.orderCount).toBe(2);
    expect(report.productTotals.rows).toHaveLength(2);
  });
});
