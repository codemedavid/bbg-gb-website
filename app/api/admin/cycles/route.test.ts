// Admin → Cycle archives: the index, and one cycle.
//
// "Once a cycle closes, all the orders, all the hatian, all the data of that
// cycle is archived, and the new cycle starts from zero." The archive is where
// that data goes: not a copy, the same rows read by the cycle they traded in.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError,
    getSession: async () => session.current,
    requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { GET: LIST } = await import('./route');
const { GET: ONE } = await import('./[key]/route');
const { getDb, orders, groupBuys, moqCampaigns } = await import('@/lib/db');
const { eq } = await import('drizzle-orm');
const { resetDb, makeUser, makeGroupBuy, makeMoqCampaign, openBoards } = await import('@/lib/test/harness');
const { getCurrentCycle } = await import('@/lib/settings');

const PAST = '2026-08-29T14:00:00.000Z';

async function placeOrder(userId: string, orderNo: string, cycleKey: string | null, status = 'proof_review') {
  const db = await getDb();
  await db.insert(orders).values({
    orderNo, userId, buyType: 'kahati', status: status as never, cycleKey,
    subtotalPhp: '1000', packingFeePhp: '150', totalPhp: '1150',
    shipName: 'QA', shipPhone: '09171234567', shipAddress: '123 Mabini St',
  });
}
const list = async () => (await (await LIST()).json()).data;
const one = async (key: string) => {
  const res = await ONE(new Request('http://localhost/x'), { params: Promise.resolve({ key: encodeURIComponent(key) }) });
  return { status: res.status, body: await res.json() };
};

beforeEach(async () => {
  await resetDb();
  await openBoards();
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
});

describe('GET /api/admin/cycles', () => {
  it('refuses a customer', async () => {
    const customer = await makeUser({ role: 'customer' });
    session.current = { sub: customer.id, role: 'customer', email: customer.email };
    expect((await LIST()).status).toBe(403);
  });

  it('lists each cycle newest first with what it holds, marking the current one', async () => {
    const db = await getDb();
    const now = (await getCurrentCycle())!.opensAt;
    await placeOrder(session.current!.sub, 'BBG-1', PAST);
    await placeOrder(session.current!.sub, 'BBG-2', PAST, 'cancelled');
    await placeOrder(session.current!.sub, 'BBG-3', now);
    const sealed = await makeGroupBuy({ name: 'Reta', status: 'closed', claimedSlots: 7 });
    await db.update(groupBuys).set({ cycleKey: PAST }).where(eq(groupBuys.id, sealed.id));
    const batch = await makeMoqCampaign({ committed: 4, status: 'approved' });
    await db.update(moqCampaigns).set({ cycleKey: PAST }).where(eq(moqCampaigns.id, batch.id));
    await placeOrder(session.current!.sub, 'BBG-OLD', null);

    const rows = await list();

    expect(rows.map((r: { cycleKey: string }) => r.cycleKey)).toEqual([now, PAST]);
    expect(rows[0]).toMatchObject({ current: true, orders: 1 });
    expect(rows[1]).toMatchObject({
      current: false, label: 'Cycle of 29 Aug 2026',
      orders: 2, cancelledOrders: 1, kahatis: 1, vials: 7, campaigns: 1, kits: 4,
    });
  });
});

describe('GET /api/admin/cycles/[key]', () => {
  it('returns the counters, batches and orders of that cycle and no other', async () => {
    const db = await getDb();
    const now = (await getCurrentCycle())!.opensAt;
    await placeOrder(session.current!.sub, 'BBG-1', PAST);
    await placeOrder(session.current!.sub, 'BBG-3', now);
    const sealed = await makeGroupBuy({ name: 'Reta', status: 'closed', claimedSlots: 7 });
    await db.update(groupBuys).set({ cycleKey: PAST }).where(eq(groupBuys.id, sealed.id));
    const fresh = await makeGroupBuy({ name: 'Reta again' });
    await db.update(groupBuys).set({ cycleKey: now }).where(eq(groupBuys.id, fresh.id));
    const batch = await makeMoqCampaign({ committed: 4, status: 'approved' });
    await db.update(moqCampaigns).set({ cycleKey: PAST }).where(eq(moqCampaigns.id, batch.id));

    const { status, body } = await one(PAST);

    expect(status).toBe(200);
    expect(body.data.label).toBe('Cycle of 29 Aug 2026');
    expect(body.data.current).toBe(false);
    expect(body.data.kahatis.map((k: { name: string }) => k.name)).toEqual(['Reta']);
    expect(body.data.kahatis[0].claimedSlots).toBe(7);
    expect(body.data.campaigns).toHaveLength(1);
    expect(body.data.campaigns[0]).toMatchObject({ committed: 4, capacity: 10 });
    expect(body.data.orders.map((o: { orderNo: string }) => o.orderNo)).toEqual(['BBG-1']);
  });

  it('404s for a cycle nothing was filed under', async () => {
    expect((await one('2020-01-01T00:00:00.000Z')).status).toBe(404);
  });

  it('400s for a key that is not a cycle', async () => {
    expect((await one('not-a-cycle')).status).toBe(400);
  });
});
