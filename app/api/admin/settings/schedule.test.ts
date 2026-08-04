// The admin endpoint that configures the ONE shared Group Buy + Hatian window.
//
// Phase 1 of the requirement is "the admin sets an opening and a closing time
// and both modules follow it, with no manual intervention". This is the only
// write path to that window, so it is where a bad window has to be refused:
// once a corrupt pair of instants is in the settings table, every read of the
// storefront is guessing. A rejected PATCH must also leave the PREVIOUS window
// intact — a typo cannot be allowed to take both boards down as a side effect.
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

const { GET, PATCH } = await import('./route');
const { getGroupBuySchedule } = await import('@/lib/settings');
const { resetDb, makeUser } = await import('@/lib/test/harness');

const OPENS = '2026-08-04T01:00:00.000Z'; // Aug 4, 09:00 PHT
const CLOSES = '2026-08-11T15:59:00.000Z'; // Aug 11, 23:59 PHT

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const patchReq = (body: unknown): Request =>
  new Request('http://localhost/api/admin/settings', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

const patchSchedule = (schedule: unknown) => PATCH(patchReq({ groupBuySchedule: schedule }));

beforeEach(async () => {
  await resetDb();
  session.current = null;
});

describe('GET /api/admin/settings — the shared schedule', () => {
  it('reports an unconfigured window as unset rather than omitting it', async () => {
    // The admin form binds to this shape on first load; a missing key would
    // render an uncontrolled input and lose the admin's first entry.
    await signIn('admin');

    const body = await (await GET()).json();

    expect(body.data.groupBuySchedule).toEqual({ opensAt: null, closesAt: null });
  });

  it('reports the configured window', async () => {
    await signIn('admin');
    await patchSchedule({ opensAt: OPENS, closesAt: CLOSES });

    const body = await (await GET()).json();

    expect(body.data.groupBuySchedule).toEqual({ opensAt: OPENS, closesAt: CLOSES });
  });
});

describe('PATCH /api/admin/settings — the shared schedule', () => {
  it('stores a window the admin configured', async () => {
    await signIn('admin');

    const res = await patchSchedule({ opensAt: OPENS, closesAt: CLOSES });

    expect(res.status).toBe(200);
    expect((await res.json()).data.groupBuySchedule).toEqual({ opensAt: OPENS, closesAt: CLOSES });
    expect(await getGroupBuySchedule()).toEqual({ opensAt: OPENS, closesAt: CLOSES });
  });

  it('normalises an offset-bearing instant to one canonical form', async () => {
    // The admin form posts a PHT-derived instant; two spellings of the same
    // moment must not be storable as two different windows.
    await signIn('admin');

    await patchSchedule({ opensAt: '2026-08-04T09:00:00+08:00', closesAt: CLOSES });

    expect((await getGroupBuySchedule()).opensAt).toBe(OPENS);
  });

  it('clears the window back to unset', async () => {
    await signIn('admin');
    await patchSchedule({ opensAt: OPENS, closesAt: CLOSES });

    const res = await patchSchedule({ opensAt: null, closesAt: null });

    expect(res.status).toBe(200);
    expect(await getGroupBuySchedule()).toEqual({ opensAt: null, closesAt: null });
  });

  it('refuses a window that closes before it opens, as a 400 not a 500', async () => {
    await signIn('admin');

    const res = await patchSchedule({ opensAt: CLOSES, closesAt: OPENS });

    expect(res.status).toBe(400);
  });

  it('refuses an unparseable instant', async () => {
    await signIn('admin');

    const res = await patchSchedule({ opensAt: 'next tuesday', closesAt: CLOSES });

    expect(res.status).toBe(400);
  });

  it('leaves the previous window intact when it rejects a new one', async () => {
    // The failure that would hurt most: an admin fat-fingers the close date and
    // the storefront goes dark because the good window was cleared first.
    await signIn('admin');
    await patchSchedule({ opensAt: OPENS, closesAt: CLOSES });

    await patchSchedule({ opensAt: CLOSES, closesAt: OPENS });

    expect(await getGroupBuySchedule()).toEqual({ opensAt: OPENS, closesAt: CLOSES });
  });

  it('leaves the window alone when the patch does not mention it', async () => {
    // The settings screen PATCHes one card at a time.
    await signIn('admin');
    await patchSchedule({ opensAt: OPENS, closesAt: CLOSES });

    await PATCH(patchReq({ kahatiDownpayment: 500 }));

    expect(await getGroupBuySchedule()).toEqual({ opensAt: OPENS, closesAt: CLOSES });
  });

  it('refuses a non-admin', async () => {
    // This one endpoint decides whether the storefront trades at all.
    await signIn('customer');

    const res = await patchSchedule({ opensAt: OPENS, closesAt: CLOSES });

    expect(res.status).toBe(403);
    expect(await getGroupBuySchedule()).toEqual({ opensAt: null, closesAt: null });
  });
});
