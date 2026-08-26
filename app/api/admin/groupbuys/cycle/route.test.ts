// POST /api/admin/groupbuys/cycle — the hatian board's "Start new cycle".
//
// The mirror of POST /api/campaigns/cycle on the Group Buy side: one admin-only
// call that ends every counter with vials on it and opens each one's successor,
// so a trading cycle is closed from the board rather than card by card.
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

const { POST } = await import('./route');
const { getDb, groupBuys } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy } = await import('@/lib/test/harness');
const { asc, eq } = await import('drizzle-orm');

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const req = () => new Request('http://localhost/api/admin/groupbuys/cycle', { method: 'POST' });

const countersNamed = async (name: string) => {
  const db = await getDb();
  return db.select().from(groupBuys).where(eq(groupBuys.name, name)).orderBy(asc(groupBuys.createdAt));
};

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('POST /api/admin/groupbuys/cycle', () => {
  it('ends every joined counter and opens its successor', async () => {
    await signIn('admin');
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 4 });

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.rolled).toBe(1);
    const [sealed, successor] = await countersNamed('KLOW 80mg');
    expect(sealed.status).toBe('closed');
    expect(successor.status).toBe('open');
    expect(successor.claimedSlots).toBe(0);
  });

  // Said out loud in the response so the admin can be told the board was not
  // wiped — an empty counter that stayed put is not a failure.
  it('reports the counters it deliberately left running', async () => {
    await signIn('admin');
    await makeGroupBuy({ name: 'Joined', totalSlots: 10, claimedSlots: 2 });
    await makeGroupBuy({ name: 'Empty', totalSlots: 10, claimedSlots: 0 });

    const body = await (await POST(req())).json();

    expect(body.data.rolled).toBe(1);
    expect(body.data.skippedEmpty).toBe(1);
    expect(body.data.counters).toEqual([
      expect.objectContaining({ name: 'Joined', endedWithVials: 2 }),
    ]);
  });

  it('refuses a customer', async () => {
    await signIn('customer');
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 4 });

    const res = await POST(req());

    expect(res.status).toBe(403);
    expect((await countersNamed('KLOW 80mg'))[0].status).toBe('open');
  });

  it('refuses a signed-out visitor', async () => {
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 4 });

    const res = await POST(req());

    expect(res.status).toBe(401);
    expect((await countersNamed('KLOW 80mg'))[0].status).toBe('open');
  });
});
