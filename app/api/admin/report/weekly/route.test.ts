import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'admin'; email: string } | null };

vi.mock('@/lib/session', () => ({
  requireAdmin: async () => {
    if (!session.current) throw new Error('Admin session required.');
    return session.current;
  },
}));

const { GET } = await import('./route');
const { getDb, orders } = await import('@/lib/db');
const { makeUser, resetDb } = await import('@/lib/test/harness');

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
});

describe('GET /api/admin/report/weekly packing fees', () => {
  it('carries the order packing fee into the report row and weekly total', async () => {
    const customer = await makeUser();
    const db = await getDb();
    await db.insert(orders).values({
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
    });

    const res = await GET(new Request('http://localhost/api/admin/report/weekly?week=2026-05-25'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.report.rows[0].packingFeePhp).toBe(200);
    expect(body.data.report.totals.packingFeePhp).toBe(200);
  });
});
