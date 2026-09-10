// Integration tests for admin hatian (kahati) management.
//
// A hatian fills exactly one kit — 10 vials. The API is the place that rule is
// enforced: the admin UI must not be able to create a 50-vial hatian, a new
// hatian starts at 0 claimed vials, and editing the count up to the cap has to
// close the counter in the database, not just in the UI.
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

const { GET, POST } = await import('./route');
const { PATCH } = await import('./[id]/route');
const { getDb, groupBuys } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy } = await import('@/lib/test/harness');
const { eq } = await import('drizzle-orm');
const { KAHATI_MAX_VIALS } = await import('@/lib/kahati');

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const postReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/admin/groupbuys', { method: 'POST', body: JSON.stringify(body) });

const patchReq = (id: string, body: Record<string, unknown>) =>
  new Request(`http://localhost/api/admin/groupbuys/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

const validBody = (o: Record<string, unknown> = {}) => ({
  name: 'Retatrutide Hatian', pricePerKitPhp: 9000, totalSlots: KAHATI_MAX_VIALS, minVials: 1, ...o,
});

async function rowOf(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

// The admin board is THIS cycle's board. Every cycle seals each joined counter
// and opens a successor beside it, and a list of every row ever written shows
// last cycle's 6/10 next to this cycle's 0/10 for every product — which reads
// exactly as "start new cycle removed nothing". Ended counters from earlier
// cycles are in the cycle archive instead.
describe('GET /api/admin/groupbuys — this cycle\'s board', () => {
  const PAST = '2026-08-29T14:00:00.000Z';
  const listedNames = async () => ((await (await GET()).json()).data as { name: string }[]).map((g) => g.name).sort();

  beforeEach(async () => {
    await signIn();
    const { openBoards } = await import('@/lib/test/harness');
    await openBoards();
  });

  it('lists every counter still trading, whatever cycle it was stamped with', async () => {
    const db = await getDb();
    const open = await makeGroupBuy({ name: 'Open' });
    await db.update(groupBuys).set({ cycleKey: PAST }).where(eq(groupBuys.id, open.id));
    const pasalo = await makeGroupBuy({ name: 'Pasalo', status: 'pasalo', claimedSlots: 5 });
    await db.update(groupBuys).set({ cycleKey: PAST }).where(eq(groupBuys.id, pasalo.id));

    expect(await listedNames()).toEqual(['Open', 'Pasalo']);
  });

  it('files a counter that ended in an earlier cycle', async () => {
    const db = await getDb();
    await makeGroupBuy({ name: 'This cycle' });
    const old = await makeGroupBuy({ name: 'Last cycle', status: 'closed', claimedSlots: 6 });
    await db.update(groupBuys).set({ cycleKey: PAST }).where(eq(groupBuys.id, old.id));

    expect(await listedNames()).toEqual(['This cycle']);
  });

  it('keeps a counter that ended in the current cycle', async () => {
    const db = await getDb();
    const { getCurrentCycle } = await import('@/lib/settings');
    const cycle = await getCurrentCycle();
    const filled = await makeGroupBuy({ name: 'Filled today', status: 'closed', claimedSlots: 10 });
    await db.update(groupBuys).set({ cycleKey: cycle!.opensAt }).where(eq(groupBuys.id, filled.id));

    expect(await listedNames()).toEqual(['Filled today']);
  });

  // A finished counter with no cycle is from before cycles were named. It has
  // no cycle to belong to, so it is not this one's.
  it('files an ended counter that never traded under a cycle', async () => {
    await makeGroupBuy({ name: 'Ancient', status: 'closed', claimedSlots: 3 });

    expect(await listedNames()).toEqual([]);
  });
});

describe('POST /api/admin/groupbuys', () => {
  it('rejects non-admins', async () => {
    await signIn('customer');
    expect((await POST(postReq(validBody()))).status).toBe(403);
  });

  it('starts a new hatian at 0 claimed vials', async () => {
    await signIn();
    const body = await (await POST(postReq(validBody()))).json();
    expect(body.data.claimedSlots).toBe(0);
    expect(body.data.status).toBe('open');
  });

  it('creates a hatian capped at one kit (10 vials)', async () => {
    await signIn();
    const body = await (await POST(postReq(validBody()))).json();
    expect(body.data.totalSlots).toBe(KAHATI_MAX_VIALS);
  });

  it('rejects a vial cap above one kit', async () => {
    await signIn();
    const res = await POST(postReq(validBody({ totalSlots: 50 })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/10/);
  });

  it('rejects a per-person minimum larger than the whole kit', async () => {
    await signIn();
    const res = await POST(postReq(validBody({ minVials: 11 })));
    expect(res.status).toBe(400);
  });

  it('defaults the vial cap to one kit when the field is omitted', async () => {
    await signIn();
    const { totalSlots, ...withoutCap } = validBody();
    const body = await (await POST(postReq(withoutCap))).json();
    expect(body.data.totalSlots).toBe(KAHATI_MAX_VIALS);
  });
});

describe('PATCH /api/admin/groupbuys/[id]', () => {
  it('closes the hatian in the database when an edit fills the kit', async () => {
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 4 });

    const res = await PATCH(patchReq(gb.id, { claimedSlots: 10 }), { params: Promise.resolve({ id: gb.id }) });

    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('closed');
    expect((await rowOf(gb.id)).status).toBe('closed');
  });

  it('leaves an under-filled hatian open', async () => {
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 1 });

    await PATCH(patchReq(gb.id, { claimedSlots: 9 }), { params: Promise.resolve({ id: gb.id }) });

    expect((await rowOf(gb.id)).status).toBe('open');
  });

  it('reopens a closed hatian when the admin rolls the count back', async () => {
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 10, status: 'closed' });

    await PATCH(patchReq(gb.id, { claimedSlots: 2, status: 'open' }), { params: Promise.resolve({ id: gb.id }) });

    const row = await rowOf(gb.id);
    expect(row.status).toBe('open');
    expect(row.claimedSlots).toBe(2);
  });

  it('does not silently reopen a hatian the admin explicitly closed', async () => {
    await signIn();
    // At or above the 7-vial minimum a close stays a close. (Below it, closing
    // is a cancellation by business rule — covered in [id]/lifecycle.test.ts.)
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 7 });

    await PATCH(patchReq(gb.id, { status: 'closed' }), { params: Promise.resolve({ id: gb.id }) });

    expect((await rowOf(gb.id)).status).toBe('closed');
  });

  it('rejects raising the vial cap beyond one kit', async () => {
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10 });
    const res = await PATCH(patchReq(gb.id, { totalSlots: 40 }), { params: Promise.resolve({ id: gb.id }) });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/groupbuys', () => {
  it('lists hatians for admins only', async () => {
    await signIn('customer');
    expect((await GET()).status).toBe(403);

    await signIn();
    await makeGroupBuy({ name: 'Board item' });
    const body = await (await GET()).json();
    expect(body.data).toHaveLength(1);
  });
});
