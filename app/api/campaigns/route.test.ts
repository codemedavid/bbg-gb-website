// Integration tests for the Group Buy (MOQ) campaign routes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const getSession = async () => session.current;
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError,
    getSession,
    requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { GET: LIST, POST: CREATE } = await import('./route');
const { POST: ACTION } = await import('./[id]/action/route');
const { POST: COMMIT } = await import('@/app/api/orders/route');
const { getDb, moqCampaigns, orders } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeMoqCampaign, commitRequest } = await import('@/lib/test/harness');

async function signIn(role: 'customer' | 'admin' = 'customer') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (body: unknown) =>
  new Request('http://localhost', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('GET /api/campaigns', () => {
  it('lists campaigns with derived progress and reached flags', async () => {
    await makeMoqCampaign({ moq: 10, committed: 6 });
    await makeMoqCampaign({ moq: 5, committed: 5 });
    const res = await LIST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    const reached = body.data.find((c: { reached: boolean }) => c.reached);
    const open = body.data.find((c: { reached: boolean }) => !c.reached);
    expect(reached.remaining).toBe(0);
    expect(open.remaining).toBe(4);
    expect(open.progress).toBeCloseTo(0.6);
  });
});

// The admin board is THIS cycle's board. Ended batches from earlier cycles are
// in the cycle archive, so a series does not show last cycle's 4/10 folded
// under this cycle's 0/10 for every group buy on the board.
describe('GET /api/campaigns — the admin sees this cycle\'s board', () => {
  const PAST = '2026-08-29T14:00:00.000Z';
  const listedIds = async () => ((await (await LIST()).json()).data as { id: string }[]).map((c) => c.id).sort();
  const stamp = async (id: string, cycleKey: string) =>
    (await getDb()).update(moqCampaigns).set({ cycleKey }).where(eq(moqCampaigns.id, id));

  it('files an approved batch from an earlier cycle, keeps its open successor', async () => {
    await signIn('admin');
    const old = await makeMoqCampaign({ committed: 4, status: 'approved' });
    await stamp(old.id, PAST);
    const next = await makeMoqCampaign({ seriesId: old.seriesId, batchNo: 2 });

    expect(await listedIds()).toEqual([next.id].sort());
  });

  it('keeps a batch approved in the current cycle', async () => {
    await signIn('admin');
    const { getCurrentCycle } = await import('@/lib/settings');
    const approved = await makeMoqCampaign({ committed: 4, status: 'approved' });
    await stamp(approved.id, (await getCurrentCycle())!.opensAt);

    expect(await listedIds()).toEqual([approved.id]);
  });

  // The customer board is unchanged: joinable batches, whatever their cycle.
  it('still shows a customer every open batch', async () => {
    const open = await makeMoqCampaign({ committed: 1 });
    await stamp(open.id, PAST);
    const approved = await makeMoqCampaign({ committed: 4, status: 'approved' });
    await stamp(approved.id, PAST);

    expect(await listedIds()).toEqual([open.id, approved.id].sort());
  });
});

describe('POST /api/campaigns (admin create)', () => {
  it('rejects non-admins', async () => {
    await signIn('customer');
    const res = await CREATE(jsonReq({ name: 'X', pricePerKitPhp: 10400, moq: 10 }));
    expect(res.status).toBe(403);
  });
  it('creates a campaign for an admin', async () => {
    await signIn('admin');
    const res = await CREATE(jsonReq({ name: 'July Batch', pricePerKitPhp: 10400, moq: 10 }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({ name: 'July Batch', moq: 10, committed: 0, status: 'open' });
  });
});

describe('POST /api/campaigns/[id]/action (admin lifecycle)', () => {
  it('approves an open campaign', async () => {
    await signIn('admin');
    const c = await makeMoqCampaign({ status: 'open' });
    const res = await ACTION(jsonReq({ action: 'approve' }), ctx(c.id));
    expect(res.status).toBe(200);
    const [row] = await (await getDb()).select().from(moqCampaigns).where(eq(moqCampaigns.id, c.id));
    expect(row.status).toBe('approved');
  });
  it('rejects an action on an already-cancelled campaign', async () => {
    await signIn('admin');
    const c = await makeMoqCampaign({ status: 'cancelled' });
    const res = await ACTION(jsonReq({ action: 'approve' }), ctx(c.id));
    expect(res.status).toBe(400);
  });
  it('rejects lifecycle actions from non-admins', async () => {
    await signIn('customer');
    const c = await makeMoqCampaign({ status: 'open' });
    const res = await ACTION(jsonReq({ action: 'cancel' }), ctx(c.id));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/campaigns/[id]/commit (customer)', () => {
  it('records a commitment, increments committed, and creates a held group_buy order with proof', async () => {
    const user = await signIn('customer');
    const c = await makeMoqCampaign({ moq: 10, committed: 0, perCustomerMin: 1, pricePerKitPhp: 10400 });
    const res = await COMMIT(commitRequest(c.id, 3));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.totals).toMatchObject({ subtotal: 31200, packingFee: 300, total: 31500 });

    const [row] = await (await getDb()).select().from(moqCampaigns).where(eq(moqCampaigns.id, c.id));
    expect(row.committed).toBe(3);
    const placed = await (await getDb()).select().from(orders).where(eq(orders.userId, user.id));
    expect(placed).toHaveLength(1);
    expect(placed[0].buyType).toBe('group_buy');
    expect(placed[0].paymentProofKey).toBeTruthy();
  });

  it('rejects a commitment with no payment proof', async () => {
    await signIn('customer');
    const c = await makeMoqCampaign();
    const res = await COMMIT(commitRequest(c.id, 2, { withProof: false }));
    expect(res.status).toBe(400);
  });

  it('accepts a commitment of any positive quantity — group buys have no per-customer minimum', async () => {
    await signIn('customer');
    const c = await makeMoqCampaign({ moq: 10 });
    const res = await COMMIT(commitRequest(c.id, 1));
    expect(res.status).toBe(201);
  });

  it('rejects a commitment to a non-open campaign', async () => {
    await signIn('customer');
    const c = await makeMoqCampaign({ status: 'approved' });
    const res = await COMMIT(commitRequest(c.id, 2));
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const c = await makeMoqCampaign();
    const res = await COMMIT(commitRequest(c.id, 2));
    expect(res.status).toBe(401);
  });
});
