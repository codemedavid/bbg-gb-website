// The shared Group Buy + Hatian schedule, stored in the `settings` table.
//
// One schedule, two modules. The admin configures it once and both boards
// follow it — which is only guaranteed if there is literally one set of keys to
// read, so there is no per-module override to drift apart. These tests pin that
// there is no way to open one board without the other.
//
// The schedule is a WEEKLY RECURRENCE (opening day/time, closing day/time in
// Philippine time), not a one-off window: the business trades every week and an
// absolute window has to be re-entered by hand each time, which is a storefront
// one forgotten edit away from being dark.
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, settings } from '@/lib/db';
import { resetDb } from '@/lib/test/harness';
import {
  getScheduleRecurrence, setScheduleRecurrence, getCurrentCycle,
  getSchedulePausedUntil, setSchedulePausedUntil, isGroupBuyOpenNow,
} from '@/lib/settings';

beforeEach(resetDb);

const WED = 3;
const UNSET = { openDay: null, openTime: null, closeDay: null, closeTime: null };
// Opens Wednesday 8:00 PM PHT, closes the following Wednesday 6:00 PM PHT.
const WED_TO_WED = { openDay: WED, openTime: '20:00', closeDay: WED, closeTime: '18:00' };

// Aug 5 and Aug 12 2026 are Wednesdays; Manila is UTC+08:00.
const MID_CYCLE = new Date('2026-08-08T00:00:00.000Z'); // Saturday, boards open
const IN_THE_GAP = new Date('2026-08-12T11:00:00.000Z'); // Wed 7:00 PM PHT, boards dark
const CYCLE = { opensAt: '2026-08-05T12:00:00.000Z', closesAt: '2026-08-12T10:00:00.000Z' };

describe('shared schedule recurrence setting', () => {
  it('is unset when nothing has ever been configured', async () => {
    expect(await getScheduleRecurrence()).toEqual(UNSET);
  });

  it('stores a recurrence and reads it back', async () => {
    const saved = await setScheduleRecurrence(WED_TO_WED);

    expect(saved).toEqual(WED_TO_WED);
    expect(await getScheduleRecurrence()).toEqual(WED_TO_WED);
  });

  it('clears the recurrence back to unset', async () => {
    await setScheduleRecurrence(WED_TO_WED);

    await setScheduleRecurrence(UNSET);

    expect(await getScheduleRecurrence()).toEqual(UNSET);
  });

  it('overwrites the existing rows instead of inserting duplicate keys', async () => {
    await setScheduleRecurrence(WED_TO_WED);
    await setScheduleRecurrence({ ...WED_TO_WED, openTime: '21:00' });

    const db = await getDb();
    const keys = (await db.select().from(settings))
      .map((r) => r.key).filter((k) => k.startsWith('schedule_'));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('persists the schedule under exactly one shared set of keys', async () => {
    // The requirement is "configure once, applies to both". If a per-module key
    // ever appears, this test is where it gets caught.
    await setScheduleRecurrence(WED_TO_WED);

    const db = await getDb();
    const keys = (await db.select().from(settings)).map((r) => r.key).sort();

    expect(keys).toEqual([
      'schedule_close_day', 'schedule_close_time',
      'schedule_open_day', 'schedule_open_time',
    ]);
  });

  it('rejects a half-set recurrence rather than storing it', async () => {
    // A half-set schedule reads as CLOSED everywhere downstream, so a save that
    // kept one end would take both boards dark while looking like it worked.
    await expect(setScheduleRecurrence({ ...WED_TO_WED, closeTime: null }))
      .rejects.toThrow();
  });

  it('rejects a day outside the week', async () => {
    await expect(setScheduleRecurrence({ ...WED_TO_WED, openDay: 7 })).rejects.toThrow();
  });

  it('rejects a time that is not a 24-hour clock time', async () => {
    await expect(setScheduleRecurrence({ ...WED_TO_WED, openTime: '9:00' })).rejects.toThrow();
    await expect(setScheduleRecurrence({ ...WED_TO_WED, closeTime: '24:00' })).rejects.toThrow();
  });
});

describe('getCurrentCycle', () => {
  it('is null when no recurrence is configured', async () => {
    expect(await getCurrentCycle(MID_CYCLE)).toBeNull();
  });

  it('resolves the running cycle from the stored recurrence', async () => {
    await setScheduleRecurrence(WED_TO_WED);

    expect(await getCurrentCycle(MID_CYCLE)).toEqual(CYCLE);
  });

  it('is null between the close and the next opening', async () => {
    await setScheduleRecurrence(WED_TO_WED);

    expect(await getCurrentCycle(IN_THE_GAP)).toBeNull();
  });

  it('fails closed when a stored value has been corrupted underneath it', async () => {
    const db = await getDb();
    await db.insert(settings).values({ key: 'schedule_open_day', value: 'wednesday' });
    await db.insert(settings).values({ key: 'schedule_open_time', value: '20:00' });
    await db.insert(settings).values({ key: 'schedule_close_day', value: '3' });
    await db.insert(settings).values({ key: 'schedule_close_time', value: '18:00' });

    expect(await getCurrentCycle(MID_CYCLE)).toBeNull();
  });
});

describe('pausing the boards', () => {
  // The one thing editing the recurrence cannot express: take THIS cycle dark
  // and let the next one open on schedule as usual.
  it('is not paused by default', async () => {
    expect(await getSchedulePausedUntil()).toBeNull();
  });

  it('closes both boards while the pause is in force', async () => {
    await setScheduleRecurrence(WED_TO_WED);

    await setSchedulePausedUntil(CYCLE.closesAt);

    expect(await getCurrentCycle(MID_CYCLE)).toBeNull();
    expect(await isGroupBuyOpenNow(MID_CYCLE)).toBe(false);
  });

  it('lets the next cycle open once the pause has elapsed', async () => {
    // A pause ends the cycle it was set in; it never disables the schedule.
    await setScheduleRecurrence(WED_TO_WED);
    await setSchedulePausedUntil(CYCLE.closesAt);

    const nextWeek = new Date('2026-08-15T00:00:00.000Z');

    expect(await isGroupBuyOpenNow(nextWeek)).toBe(true);
  });

  it('is lifted by clearing it', async () => {
    await setScheduleRecurrence(WED_TO_WED);
    await setSchedulePausedUntil(CYCLE.closesAt);

    await setSchedulePausedUntil(null);

    expect(await getSchedulePausedUntil()).toBeNull();
    expect(await isGroupBuyOpenNow(MID_CYCLE)).toBe(true);
  });

  it('ignores a corrupt pause rather than closing the boards forever', async () => {
    // Failing closed is right for a missing schedule; a pause is the opposite —
    // an unreadable one must not be able to keep the storefront dark for good.
    await setScheduleRecurrence(WED_TO_WED);
    const db = await getDb();
    await db.insert(settings).values({ key: 'schedule_paused_until', value: 'whenever' });

    expect(await isGroupBuyOpenNow(MID_CYCLE)).toBe(true);
  });
});

describe('isGroupBuyOpenNow', () => {
  it('reports closed when no schedule is configured', async () => {
    expect(await isGroupBuyOpenNow(MID_CYCLE)).toBe(false);
  });

  it('reports open inside the weekly window', async () => {
    await setScheduleRecurrence(WED_TO_WED);

    expect(await isGroupBuyOpenNow(MID_CYCLE)).toBe(true);
  });

  it('reports closed outside it', async () => {
    await setScheduleRecurrence(WED_TO_WED);

    expect(await isGroupBuyOpenNow(IN_THE_GAP)).toBe(false);
  });

  it('reports open again the following week without any admin action', async () => {
    // The whole point of a recurrence: nobody has to re-enter the window.
    await setScheduleRecurrence(WED_TO_WED);

    expect(await isGroupBuyOpenNow(new Date('2026-09-05T00:00:00.000Z'))).toBe(true);
  });
});
