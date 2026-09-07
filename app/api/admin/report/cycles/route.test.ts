// The batch list the Reports page picks its dates from.
//
// The dates have to come from the orders themselves: a batch is a cycle that
// opens at 22:00 Manila, so no calendar rule reproduces it, and typing the
// range by hand is what put another batch's order into a supplier sheet.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'admin'; email: string } | null };

vi.mock('@/lib/session', () => ({
  requireAdmin: async () => {
    if (!session.current) throw new Error('Admin session required.');
    return session.current;
  },
}));

const { GET } = await import('./route');
const { getDb, orderItems, orders } = await import('@/lib/db');
const { makeUser, resetDb } = await import('@/lib/test/harness');

const AUG = '2026-08-29T14:00:00.000Z';
const SEP = '2026-09-05T14:00:00.000Z';

async function seedKahatiOrder(opts: {
  orderNo: string; cycleKey: string | null; createdAt: string; qty: number; status?: string;
}) {
  const db = await getDb();
  const user = await makeUser();
  const [order] = await db.insert(orders).values({
    orderNo: opts.orderNo, userId: user.id, status: (opts.status ?? 'payment_confirmed') as never,
    buyType: 'kahati', cycleKey: opts.cycleKey, subtotalPhp: '1000', totalPhp: '1000',
    shipName: 'Gelly', shipPhone: '0917', shipAddress: 'Manila', createdAt: new Date(opts.createdAt),
  }).returning();
  await db.insert(orderItems).values({
    orderId: order.id, kind: 'group_buy', nameSnapshot: 'TR30 — kahati',
    unitPricePhp: '637.5', qty: opts.qty, lineTotalPhp: '1000',
  });
}

const fetchCycles = async () => {
  const res = await GET(new Request('http://localhost/api/admin/report/cycles'));
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data.cycles as { cycleKey: string; from: string; to: string; orderCount: number; vials: number }[];
};

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
});

describe('GET /api/admin/report/cycles', () => {
  it('lists each batch with the dates its own orders span, newest first', async () => {
    // 16:01Z on Aug 29 is 00:01 on Aug 30 in Manila — the first order of the
    // batch, and the date the report range must open on.
    await seedKahatiOrder({ orderNo: 'KH-1', cycleKey: AUG, createdAt: '2026-08-29T16:01:00Z', qty: 4 });
    await seedKahatiOrder({ orderNo: 'KH-2', cycleKey: AUG, createdAt: '2026-09-04T14:33:00Z', qty: 6 });
    await seedKahatiOrder({ orderNo: 'KH-3', cycleKey: SEP, createdAt: '2026-09-05T16:51:00Z', qty: 8 });

    const cycles = await fetchCycles();

    expect(cycles).toEqual([
      { cycleKey: SEP, from: '2026-09-06', to: '2026-09-06', orderCount: 1, vials: 8 },
      { cycleKey: AUG, from: '2026-08-30', to: '2026-09-04', orderCount: 2, vials: 10 },
    ]);
  });

  it('keeps cancelled orders in the count but out of the vials', async () => {
    await seedKahatiOrder({ orderNo: 'KH-4', cycleKey: AUG, createdAt: '2026-08-30T02:00:00Z', qty: 5 });
    await seedKahatiOrder({ orderNo: 'KH-5', cycleKey: AUG, createdAt: '2026-08-30T03:00:00Z', qty: 3, status: 'cancelled' });

    expect(await fetchCycles()).toEqual([
      { cycleKey: AUG, from: '2026-08-30', to: '2026-08-30', orderCount: 2, vials: 5 },
    ]);
  });

  it('leaves out orders placed before batches were stamped', async () => {
    await seedKahatiOrder({ orderNo: 'BBG-9', cycleKey: null, createdAt: '2026-08-08T02:00:00Z', qty: 2 });

    expect(await fetchCycles()).toEqual([]);
  });
});
