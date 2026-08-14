// The seam between the products table and the weekly report's per-product
// rollup.
//
// `kit_size` and `code` live on the product, not on the order-item snapshot, so
// the rollup only sees them through a join. A join that silently drops rows, or
// a column the migration never added, produces a rollup that still looks
// plausible — right names, wrong kit counts — which is exactly the failure a
// unit test of the pure builder cannot catch.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  return {
    ApiError,
    getSession: async () => ({ sub: 'admin', role: 'admin', email: 'a@b.c' }),
    requireSession: async () => ({ sub: 'admin', role: 'admin', email: 'a@b.c' }),
    requireAdmin: async () => ({ sub: 'admin', role: 'admin', email: 'a@b.c' }),
  };
});

const { GET } = await import('./route');
const { getDb, categories, products, groupBuys, moqCampaigns, orders, orderItems } = await import('@/lib/db');
const { resetDb, makeUser } = await import('@/lib/test/harness');
const { buildProductTotals } = await import('@/lib/report/product-totals');
const { buildWeeklyWorkbook, GROUP_BUY_PRODUCT_TOTALS_SHEET } = await import('@/lib/report/weekly-xlsx');

const MONDAY = '2026-03-16';
const IN_WEEK = new Date('2026-03-17T02:00:00Z');

type Line = { name: string; spec: string; code: string; kitSize: number; qty: number; usd: string };

async function seedOrder(lines: Line[], status = 'payment_confirmed') {
  const db = await getDb();
  const user = await makeUser();
  const [cat] = await db.insert(categories).values({ name: 'Peptides', slug: `p-${Math.random().toString(36).slice(2, 8)}` }).returning();

  const [order] = await db.insert(orders).values({
    orderNo: `BBG-${Math.floor(Math.random() * 90000) + 10000}`,
    userId: user.id, status: status as never, subtotalPhp: '1000', totalPhp: '1000', totalUsd: '100',
    shipName: 'Gelly', shipPhone: '0917', shipAddress: 'Manila', createdAt: IN_WEEK,
  }).returning();

  for (const l of lines) {
    const [product] = await db.insert(products).values({
      code: l.code, name: l.name, spec: l.spec, categoryId: cat.id,
      pricePhp: '1000', priceUsd: l.usd, kitSize: l.kitSize,
    }).returning();

    await db.insert(orderItems).values({
      orderId: order.id, productId: product.id, nameSnapshot: l.name, specSnapshot: l.spec,
      unitPricePhp: '1000', unitPriceUsd: l.usd, qty: l.qty, lineTotalPhp: '1000',
    });
  }
}

const fetchReport = async () => {
  const res = await GET(new Request(`http://localhost/api/admin/report/weekly?week=${MONDAY}`));
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data.report;
};

beforeEach(resetDb);

describe('weekly report product totals', () => {
  it('divides quantity by the kit size stored on the product', async () => {
    await seedOrder([
      { name: 'Liquid Bacteriostatic Water', spec: '5ml', code: 'BA5', kitSize: 10, qty: 270, usd: '1.00' },
      { name: 'Lemon Bottle', spec: '50ml', code: 'LB50', kitSize: 1, qty: 33, usd: '18.00' },
    ]);

    const rows = (await fetchReport()).productTotals.rows;

    expect(rows.find((r: { code: string }) => r.code === 'BA5')).toMatchObject({ qty: 270, kits: 27, usd: 270 });
    expect(rows.find((r: { code: string }) => r.code === 'LB50')).toMatchObject({ qty: 33, kits: 33, usd: 594 });
  });

  it('carries the price-list code through the product join', async () => {
    await seedOrder([{ name: 'Tirzepatide', spec: '30mg', code: 'TR30', kitSize: 10, qty: 190, usd: '10.00' }]);

    const rows = (await fetchReport()).productTotals.rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ index: 1, name: 'Tirzepatide', code: 'TR30', spec: '30mg' });
  });

  it('defaults kit size to 10 for products created without one', async () => {
    const db = await getDb();
    const user = await makeUser();
    const [product] = await db.insert(products).values({
      code: 'NEW1', name: 'Newly Added', spec: '10mg', pricePhp: '1000', priceUsd: '5.00',
    }).returning();
    const [order] = await db.insert(orders).values({
      orderNo: 'BBG-77777', userId: user.id, status: 'payment_confirmed', subtotalPhp: '1000',
      totalPhp: '1000', totalUsd: '50', shipName: 'Gelly', shipPhone: '0917', shipAddress: 'Manila', createdAt: IN_WEEK,
    }).returning();
    await db.insert(orderItems).values({
      orderId: order.id, productId: product.id, nameSnapshot: 'Newly Added', specSnapshot: '10mg',
      unitPricePhp: '1000', unitPriceUsd: '5.00', qty: 20, lineTotalPhp: '1000',
    });

    const rows = (await fetchReport()).productTotals.rows;
    expect(rows[0].kits).toBe(2);
  });

  it('keeps the rollup consistent with the order rows it was built from', async () => {
    await seedOrder([
      { name: 'Tirzepatide', spec: '15mg', code: 'TR15', kitSize: 10, qty: 70, usd: '6.80' },
      { name: 'GHK-Cu', spec: '100mg', code: 'CU100', kitSize: 10, qty: 40, usd: '5.00' },
    ]);
    const report = await fetchReport();

    // The route's own orders, run back through the pure builder, must agree.
    expect(report.productTotals.totals.qty).toBe(110);
    expect(report.productTotals.rows.map((r: { code: string }) => r.code)).toEqual(['TR15', 'CU100']);
  });

  it('leaves cancelled orders out of the rollup', async () => {
    await seedOrder([{ name: 'Retatrutide', spec: '30mg', code: 'RT30', kitSize: 10, qty: 10, usd: '16.00' }]);
    await seedOrder([{ name: 'Retatrutide', spec: '30mg', code: 'RT30X', kitSize: 10, qty: 500, usd: '16.00' }], 'cancelled');

    const report = await fetchReport();

    expect(report.productTotals.totals.qty).toBe(10);
    expect(report.productTotals.rows.map((r: { code: string }) => r.code)).toEqual(['RT30']);
  });

  it('reports nothing for a week with no orders', async () => {
    const report = await fetchReport();

    expect(report.productTotals.rows).toEqual([]);
    expect(report.productTotals.totals).toEqual({ usd: 0, qty: 0 });
    expect(buildProductTotals([])).toEqual(report.productTotals);
  });

  it('exports one canonical product row across Kahati and campaign batches', async () => {
    const db = await getDb();
    const user = await makeUser();
    const [product] = await db.insert(products).values({
      name: 'Tirzepatide', spec: '30mg', code: 'TR30',
      pricePhp: '6375', priceUsd: '102', kitSize: 10,
      isGroupBuy: true, isKahati: true,
    }).returning();
    const [kahati] = await db.insert(groupBuys).values({
      name: 'Tirzepatide 30mg vial', productId: product.id,
      pricePerKitPhp: '6375', totalSlots: 10, claimedSlots: 0,
    }).returning();
    const seriesId = crypto.randomUUID();
    const campaigns = await db.insert(moqCampaigns).values([
      {
        id: seriesId, seriesId, batchNo: 1, name: 'Tirzepatide 30mg vial',
        pricePerKitPhp: '6375', moq: 10, committed: 2, status: 'completed',
        includedProducts: [{ productId: product.id, name: product.name, outOfStock: false }],
      },
      {
        seriesId, batchNo: 2, name: 'Tirzepatide 30mg vial',
        pricePerKitPhp: '6375', moq: 10, committed: 3, status: 'open',
        includedProducts: [{ productId: product.id, name: product.name, outOfStock: false }],
      },
    ]).returning();
    const [order] = await db.insert(orders).values({
      orderNo: 'BBG-88001', userId: user.id, status: 'payment_confirmed', buyType: 'group_buy',
      subtotalPhp: '38250', totalPhp: '38250', totalUsd: '0',
      shipName: 'Gelly', shipPhone: '0917', shipAddress: 'Manila', createdAt: IN_WEEK,
    }).returning();

    await db.insert(orderItems).values([
      {
        orderId: order.id, kind: 'group_buy', groupBuyId: kahati.id,
        nameSnapshot: 'Tirzepatide 30mg vial — kahati', specSnapshot: 'Kahati · min 1 vials',
        unitPricePhp: '637.50', qty: 10, lineTotalPhp: '6375',
      },
      ...campaigns.map((campaign, index) => ({
        orderId: order.id, kind: 'moq_campaign' as const, moqCampaignId: campaign.id,
        nameSnapshot: `Tirzepatide 30mg vial — group buy (Batch #${index + 1})`,
        specSnapshot: `Group Buy · Batch #${index + 1} · proceeds at MOQ`,
        unitPricePhp: '6375', qty: index + 2, lineTotalPhp: String(6375 * (index + 2)),
      })),
    ]);

    const res = await GET(new Request(`http://localhost/api/admin/report/weekly?week=${MONDAY}`));
    const body = await res.json();
    const groupBuyReport = body.data.segments.groupbuy;

    expect(groupBuyReport.productTotals.rows).toEqual([{
      index: 1, name: 'Tirzepatide', code: 'TR30', spec: '30mg',
      usd: 612, qty: 60, kits: 6,
    }]);

    const workbook = await buildWeeklyWorkbook(groupBuyReport, MONDAY, 'groupbuy');
    const sheet = workbook.getWorksheet(GROUP_BUY_PRODUCT_TOTALS_SHEET)!;
    expect(sheet.getRow(4).values).toEqual([
      undefined, 1, 'Tirzepatide', 'TR30', '30mg', 6, 612, 60,
    ]);
    expect(sheet.getCell('A2').value).toBe('# Orders: 1  Units: 60');
    expect(sheet.getRow(sheet.rowCount).values).toEqual([
      undefined, 'TOTAL', undefined, undefined, undefined, 60, 612, 60,
    ]);
  });
});
