// GET /api/admin/orders?cycle=…
//
// The orders screen is this cycle's screen. Every order ever placed in one
// list is a list the team scrolls past to find the batch they are packing, and
// a new cycle that leaves last cycle's orders on top of the board reads as a
// cycle that never started. Earlier cycles are in the archive, by cycle.
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

const { GET } = await import('./route');
const { getDb, orders } = await import('@/lib/db');
const { resetDb, makeUser, openBoards, closeBoards } = await import('@/lib/test/harness');
const { getCurrentCycle } = await import('@/lib/settings');

const PAST = '2026-08-29T14:00:00.000Z';

async function placeOrder(userId: string, orderNo: string, cycleKey: string | null) {
  const db = await getDb();
  await db.insert(orders).values({
    orderNo, userId, buyType: 'kahati', status: 'proof_review', cycleKey,
    subtotalPhp: '1000', packingFeePhp: '150', totalPhp: '1150',
    shipName: 'QA', shipPhone: '09171234567', shipAddress: '123 Mabini St',
  });
}

const listed = async (query = '') => {
  const res = await GET(new Request(`http://localhost/api/admin/orders${query}`));
  return ((await res.json()).data as { orderNo: string }[]).map((o) => o.orderNo).sort();
};

beforeEach(async () => {
  await resetDb();
  await openBoards();
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
  await placeOrder(admin.id, 'BBG-OLD', PAST);
  await placeOrder(admin.id, 'BBG-NOW', (await getCurrentCycle())!.opensAt);
  await placeOrder(admin.id, 'BBG-UNKEYED', null);
});

describe('GET /api/admin/orders?cycle=', () => {
  it('lists every order when no cycle is asked for', async () => {
    expect(await listed()).toEqual(['BBG-NOW', 'BBG-OLD', 'BBG-UNKEYED']);
  });

  it('scopes to the running cycle with cycle=current', async () => {
    expect(await listed('?cycle=current')).toEqual(['BBG-NOW']);
  });

  it('scopes to a named cycle from the archive', async () => {
    expect(await listed(`?cycle=${encodeURIComponent(PAST)}`)).toEqual(['BBG-OLD']);
  });

  // The boards close on Sunday night and the orders are packed on Monday. The
  // cycle being worked is the one that just closed, not "none".
  it('keeps the cycle that just closed as current while the boards are dark', async () => {
    const { setScheduleRecurrence } = await import('@/lib/settings');
    // Opens six days from now, closes a day later: the last cycle to have
    // opened is a week ago and has closed.
    const { phtCalendarDate } = await import('@/lib/schedule');
    const today = phtCalendarDate(new Date()).weekday;
    const day = ((today + 6) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    await setScheduleRecurrence({ openDay: day, openTime: '00:00', closeDay: ((day + 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6, closeTime: '00:00' });
    const { getLatestCycleKey } = await import('@/lib/settings');
    const latest = await getLatestCycleKey();
    expect(await getCurrentCycle()).toBeNull();
    expect(latest).not.toBeNull();
    await placeOrder(session.current!.sub, 'BBG-DARK', latest);

    expect(await listed('?cycle=current')).toEqual(['BBG-DARK']);
  });

  it('lists every order for cycle=current when no schedule was ever set', async () => {
    await closeBoards();
    expect(await listed('?cycle=current')).toEqual(['BBG-NOW', 'BBG-OLD', 'BBG-UNKEYED']);
  });
});
