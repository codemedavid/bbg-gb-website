// The admin endpoint that configures the ONE shared Group Buy + Hatian schedule.
//
// The requirement is "the admin sets an opening day and time and a closing day
// and time, and both modules follow it automatically, every week". This is the
// only write path to that schedule, so it is where a bad one has to be refused:
// once a corrupt recurrence is in the settings table, every read of the
// storefront is guessing. A rejected PATCH must also leave the PREVIOUS schedule
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
const { getScheduleRecurrence, getSchedulePausedUntil } = await import('@/lib/settings');
const { resetDb, makeUser } = await import('@/lib/test/harness');

const WED = 3;
const UNSET = { openDay: null, openTime: null, closeDay: null, closeTime: null };
// Opens Wednesday 8:00 PM PHT, closes the following Wednesday 6:00 PM PHT.
const WED_TO_WED = { openDay: WED, openTime: '20:00', closeDay: WED, closeTime: '18:00' };

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const patchReq = (body: unknown): Request =>
  new Request('http://localhost/api/admin/settings', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

const patchSchedule = (scheduleRecurrence: unknown) => PATCH(patchReq({ scheduleRecurrence }));

beforeEach(async () => {
  await resetDb();
  session.current = null;
});

describe('GET /api/admin/settings — the shared schedule', () => {
  it('reports an unconfigured schedule as unset rather than omitting it', async () => {
    // The admin form binds to this shape on first load; a missing key would
    // render an uncontrolled input and lose the admin's first entry.
    await signIn('admin');

    const body = await (await GET()).json();

    expect(body.data.scheduleRecurrence).toEqual(UNSET);
  });

  it('reports the configured schedule', async () => {
    await signIn('admin');
    await patchSchedule(WED_TO_WED);

    const body = await (await GET()).json();

    expect(body.data.scheduleRecurrence).toEqual(WED_TO_WED);
  });

  it('reports the cycle the recurrence currently resolves to', async () => {
    // The card shows the admin the actual instants their four fields produce.
    // Without it, "Wednesday to Wednesday" is a claim nobody can check until
    // customers either can or cannot reach the boards.
    await signIn('admin');
    await patchSchedule(WED_TO_WED);

    const body = await (await GET()).json();

    // Either the running cycle or the next one, but always a resolved window.
    expect(body.data.scheduleCycle).toEqual(
      expect.objectContaining({ opensAt: expect.any(String), closesAt: expect.any(String) }),
    );
  });
});

describe('PATCH /api/admin/settings — the shared schedule', () => {
  it('stores a schedule the admin configured', async () => {
    await signIn('admin');

    const res = await patchSchedule(WED_TO_WED);

    expect(res.status).toBe(200);
    expect((await res.json()).data.scheduleRecurrence).toEqual(WED_TO_WED);
    expect(await getScheduleRecurrence()).toEqual(WED_TO_WED);
  });

  it('clears the schedule back to unset', async () => {
    await signIn('admin');
    await patchSchedule(WED_TO_WED);

    const res = await patchSchedule(UNSET);

    expect(res.status).toBe(200);
    expect(await getScheduleRecurrence()).toEqual(UNSET);
  });

  it('refuses a half-set schedule, as a 400 not a 500', async () => {
    await signIn('admin');

    const res = await patchSchedule({ ...WED_TO_WED, closeTime: null });

    expect(res.status).toBe(400);
  });

  it('refuses a day outside the week', async () => {
    await signIn('admin');

    expect((await patchSchedule({ ...WED_TO_WED, openDay: 7 })).status).toBe(400);
  });

  it('refuses a time that is not a 24-hour clock time', async () => {
    await signIn('admin');

    expect((await patchSchedule({ ...WED_TO_WED, openTime: '9:00' })).status).toBe(400);
    expect((await patchSchedule({ ...WED_TO_WED, closeTime: '24:00' })).status).toBe(400);
    expect((await patchSchedule({ ...WED_TO_WED, closeTime: 'evening' })).status).toBe(400);
  });

  it('leaves the previous schedule intact when it rejects a new one', async () => {
    // The failure that would hurt most: an admin fat-fingers the closing time
    // and the storefront goes dark because the good schedule was cleared first.
    await signIn('admin');
    await patchSchedule(WED_TO_WED);

    await patchSchedule({ ...WED_TO_WED, closeTime: '99:99' });

    expect(await getScheduleRecurrence()).toEqual(WED_TO_WED);
  });

  it('leaves the schedule alone when the patch does not mention it', async () => {
    // The settings screen PATCHes one card at a time.
    await signIn('admin');
    await patchSchedule(WED_TO_WED);

    await PATCH(patchReq({ moqPageEnabled: true }));

    expect(await getScheduleRecurrence()).toEqual(WED_TO_WED);
  });

  it('refuses a non-admin', async () => {
    // This one endpoint decides whether the storefront trades at all.
    await signIn('customer');

    const res = await patchSchedule(WED_TO_WED);

    expect(res.status).toBe(403);
    expect(await getScheduleRecurrence()).toEqual(UNSET);
  });
});

describe('PATCH /api/admin/settings — pausing the boards', () => {
  it('stores a pause', async () => {
    await signIn('admin');
    await patchSchedule(WED_TO_WED);

    const res = await PATCH(patchReq({ schedulePausedUntil: '2026-08-12T10:00:00.000Z' }));

    expect(res.status).toBe(200);
    expect(await getSchedulePausedUntil()).toBe('2026-08-12T10:00:00.000Z');
  });

  it('lifts a pause with an explicit null', async () => {
    await signIn('admin');
    await PATCH(patchReq({ schedulePausedUntil: '2026-08-12T10:00:00.000Z' }));

    await PATCH(patchReq({ schedulePausedUntil: null }));

    expect(await getSchedulePausedUntil()).toBeNull();
  });

  it('refuses an unparseable pause', async () => {
    await signIn('admin');

    const res = await PATCH(patchReq({ schedulePausedUntil: 'next tuesday' }));

    expect(res.status).toBe(400);
  });
});
