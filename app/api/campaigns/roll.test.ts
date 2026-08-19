// Integration tests for ending a batch and starting the next one.
//
// Two doors onto the same rollover: the `roll` action on one campaign, and the
// board-wide cycle that rolls every running batch at once.
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

const { POST: ACTION } = await import('./[id]/action/route');
const { POST: CYCLE } = await import('./cycle/route');
const { getDb, moqCampaigns } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeMoqCampaign } = await import('@/lib/test/harness');

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (body: unknown) =>
  new Request('http://localhost', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const seriesRows = async (seriesId: string) => {
  const db = await getDb();
  return db.select().from(moqCampaigns).where(eq(moqCampaigns.seriesId, seriesId));
};

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('POST /api/campaigns/[id]/action — roll', () => {
  it('ends the batch and answers with the successor that is now open', async () => {
    await signIn('admin');
    const batch = await makeMoqCampaign({ committed: 4 });

    const res = await ACTION(jsonReq({ action: 'roll' }), ctx(batch.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.batchNo).toBe(2);
    expect(body.data.status).toBe('open');
    expect(body.data.committed).toBe(0);

    const rows = await seriesRows(batch.seriesId);
    expect(rows.find((r) => r.id === batch.id)!.status).toBe('approved');
    expect(rows).toHaveLength(2);
  });

  it('refuses a batch that is not running', async () => {
    await signIn('admin');
    const batch = await makeMoqCampaign({ committed: 2, status: 'approved' });

    const res = await ACTION(jsonReq({ action: 'roll' }), ctx(batch.id));

    expect(res.status).toBe(400);
    expect(await seriesRows(batch.seriesId)).toHaveLength(1);
  });

  it('refuses a customer', async () => {
    await signIn('customer');
    const batch = await makeMoqCampaign({ committed: 2 });

    const res = await ACTION(jsonReq({ action: 'roll' }), ctx(batch.id));

    expect(res.status).toBe(403);
    expect(await seriesRows(batch.seriesId)).toHaveLength(1);
  });
});

describe('POST /api/campaigns/cycle', () => {
  it('rolls every running batch and reports what it skipped', async () => {
    await signIn('admin');
    const joined = await makeMoqCampaign({ committed: 3 });
    const empty = await makeMoqCampaign({ committed: 0 });

    const res = await CYCLE();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.rolled).toBe(1);
    expect(body.data.skippedEmpty).toBe(1);
    expect(await seriesRows(joined.seriesId)).toHaveLength(2);
    expect(await seriesRows(empty.seriesId)).toHaveLength(1);
  });

  it('refuses a customer', async () => {
    await signIn('customer');
    const batch = await makeMoqCampaign({ committed: 3 });

    const res = await CYCLE();

    expect(res.status).toBe(403);
    expect(await seriesRows(batch.seriesId)).toHaveLength(1);
  });
});
