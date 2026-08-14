import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const session = { current: null as { sub: string; role: 'admin'; email: string } | null };

vi.mock('@/lib/session', () => ({
  requireAdmin: async () => {
    if (!session.current) throw new Error('Admin session required.');
    return session.current;
  },
}));

const { GET } = await import('./route');
const { getDb, orderItems, orders, products } = await import('@/lib/db');
const { makeProduct, makeUser, resetDb } = await import('@/lib/test/harness');

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
});

describe('GET /api/admin/report/weekly packing fees', () => {
  it('carries the order packing fee into the report row and weekly total', async () => {
    const customer = await makeUser();
    const product = await makeProduct({ name: 'Retatrutide', spec: '10mg vial' });
    const db = await getDb();
    // Existing deployments may still hold the old supplier code. The report
    // must use the new Cat. No. supplied by the client.
    await db.update(products).set({ code: 'BBG1000-R10' }).where(eq(products.id, product.id));
    const [order] = await db.insert(orders).values({
      orderNo: 'BBG-REPORT-FEE',
      userId: customer.id,
      status: 'payment_confirmed',
      buyType: 'solo',
      subtotalPhp: '1000',
      packingFeePhp: '200',
      totalPhp: '1200',
      shipName: 'Report Customer',
      shipPhone: '09170000000',
      shipAddress: 'Test address',
      createdAt: new Date('2026-05-27T02:00:00Z'),
    }).returning();
    await db.insert(orderItems).values({
      orderId: order.id,
      kind: 'product',
      productId: product.id,
      nameSnapshot: 'Retatrutide 10mg vial',
      specSnapshot: 'On-hand · per piece',
      unitPricePhp: '1000',
      qty: 1,
      lineTotalPhp: '1000',
    });

    const res = await GET(new Request('http://localhost/api/admin/report/weekly?week=2026-05-25'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.report.rows[0].packingFeePhp).toBe(200);
    expect(body.data.report.totals.packingFee).toBe(200);
    expect(body.data.report.rows[0].productCodes).toEqual(['RT10']);
    expect(body.data.report.rows[0].buyType).toBe('solo');
  });
});
