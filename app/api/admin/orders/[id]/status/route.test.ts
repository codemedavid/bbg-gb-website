// Integration tests: cancelling a group-buy order releases the campaign commitment.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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

const { PATCH } = await import('./route');
const { POST: COMMIT } = await import('@/app/api/campaigns/[id]/commit/route');
const { getDb, moqCampaigns } = await import('@/lib/db');
const { resetDb, makeUser, makeMoqCampaign, commitRequest } = await import('@/lib/test/harness');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const statusReq = (status: string) =>
  new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ status }), headers: { 'content-type': 'application/json' } });

async function commitAs(role: 'customer', campaignId: string, qty: number) {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role, email: user.email };
  const res = await COMMIT(commitRequest(qty), ctx(campaignId));
  return (await res.json()).data.order.id as string;
}

async function committedOf(id: string) {
  const [row] = await (await getDb()).select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
  return row.committed;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('PATCH /api/admin/orders/[id]/status — group-buy commitment release', () => {
  it('decrements campaign committed when a group-buy order is cancelled', async () => {
    const c = await makeMoqCampaign({ moq: 10, committed: 0 });
    const orderId = await commitAs('customer', c.id, 3);
    expect(await committedOf(c.id)).toBe(3);

    const admin = await makeUser({ role: 'admin' });
    session.current = { sub: admin.id, role: 'admin', email: admin.email };
    const res = await PATCH(statusReq('cancelled'), ctx(orderId));
    expect(res.status).toBe(200);
    expect(await committedOf(c.id)).toBe(0);
  });

  it('does not double-decrement when an already-cancelled order is cancelled again', async () => {
    const c = await makeMoqCampaign({ moq: 10, committed: 0 });
    const orderId = await commitAs('customer', c.id, 4);

    const admin = await makeUser({ role: 'admin' });
    session.current = { sub: admin.id, role: 'admin', email: admin.email };
    await PATCH(statusReq('cancelled'), ctx(orderId));
    await PATCH(statusReq('cancelled'), ctx(orderId));
    expect(await committedOf(c.id)).toBe(0);
  });

  it('leaves committed untouched for a non-cancel transition', async () => {
    const c = await makeMoqCampaign({ moq: 10, committed: 0 });
    const orderId = await commitAs('customer', c.id, 2);

    const admin = await makeUser({ role: 'admin' });
    session.current = { sub: admin.id, role: 'admin', email: admin.email };
    await PATCH(statusReq('payment_confirmed'), ctx(orderId));
    expect(await committedOf(c.id)).toBe(2);
  });
});
