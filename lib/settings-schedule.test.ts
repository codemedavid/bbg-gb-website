// The shared Group Buy + Hatian schedule, stored in the `settings` table.
//
// One schedule, two modules. The admin configures it once and both boards
// follow it — which is only guaranteed if there is literally one pair of keys to
// read, so there is no per-module override to drift apart. These tests pin that
// there is no way to open one board without the other.
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, settings } from '@/lib/db';
import { resetDb } from '@/lib/test/harness';
import { getGroupBuySchedule, setGroupBuySchedule, isGroupBuyOpenNow } from '@/lib/settings';

beforeEach(resetDb);

const OPENS = '2026-08-04T01:00:00.000Z';
const CLOSES = '2026-08-11T15:59:00.000Z';

describe('shared group buy schedule setting', () => {
  it('is unset when nothing has ever been configured', async () => {
    expect(await getGroupBuySchedule()).toEqual({ opensAt: null, closesAt: null });
  });

  it('stores a window and reads it back', async () => {
    const saved = await setGroupBuySchedule({ opensAt: OPENS, closesAt: CLOSES });
    expect(saved).toEqual({ opensAt: OPENS, closesAt: CLOSES });
    expect(await getGroupBuySchedule()).toEqual({ opensAt: OPENS, closesAt: CLOSES });
  });

  it('normalises the stored instants so a re-save cannot drift the format', async () => {
    // Accepts anything Date can parse and writes one canonical ISO form; two
    // spellings of the same instant must not compare as two different windows.
    await setGroupBuySchedule({ opensAt: '2026-08-04T09:00:00+08:00', closesAt: CLOSES });
    expect((await getGroupBuySchedule()).opensAt).toBe(OPENS);
  });

  it('clears a window back to unset', async () => {
    await setGroupBuySchedule({ opensAt: OPENS, closesAt: CLOSES });
    await setGroupBuySchedule({ opensAt: null, closesAt: null });
    expect(await getGroupBuySchedule()).toEqual({ opensAt: null, closesAt: null });
  });

  it('overwrites the existing rows instead of inserting duplicate keys', async () => {
    await setGroupBuySchedule({ opensAt: OPENS, closesAt: CLOSES });
    await setGroupBuySchedule({ opensAt: CLOSES, closesAt: null });
    const db = await getDb();
    const rows = (await db.select().from(settings))
      .filter((r) => r.key.startsWith('group_buy_schedule'));
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rejects an unparseable instant rather than storing it', async () => {
    await expect(setGroupBuySchedule({ opensAt: 'next tuesday', closesAt: CLOSES }))
      .rejects.toThrow();
  });

  it('rejects a window that closes before it opens', async () => {
    // Caught at the boundary, so the corrupt state never reaches the database.
    // isScheduleOpen also fails closed on it — belt and braces, because a row
    // written before this validation existed must still not open the storefront.
    await expect(setGroupBuySchedule({ opensAt: CLOSES, closesAt: OPENS }))
      .rejects.toThrow();
  });

  it('persists the window under exactly one shared pair of keys', async () => {
    // The requirement is "configure once, applies to both". If a per-module key
    // ever appears, this test is where it gets caught.
    await setGroupBuySchedule({ opensAt: OPENS, closesAt: CLOSES });
    const db = await getDb();
    const keys = (await db.select().from(settings)).map((r) => r.key).sort();
    expect(keys).toEqual(['group_buy_schedule_closes_at', 'group_buy_schedule_opens_at']);
  });
});

describe('isGroupBuyOpenNow', () => {
  it('reports closed when no schedule is configured', async () => {
    expect(await isGroupBuyOpenNow()).toBe(false);
  });

  it('reports open inside the stored window', async () => {
    await setGroupBuySchedule({ opensAt: OPENS, closesAt: CLOSES });
    expect(await isGroupBuyOpenNow(new Date('2026-08-06T04:00:00.000Z'))).toBe(true);
  });

  it('reports closed outside the stored window', async () => {
    await setGroupBuySchedule({ opensAt: OPENS, closesAt: CLOSES });
    expect(await isGroupBuyOpenNow(new Date('2026-08-20T04:00:00.000Z'))).toBe(false);
  });

  it('fails closed when a stored value has been corrupted underneath it', async () => {
    const db = await getDb();
    await db.insert(settings).values({ key: 'group_buy_schedule_opens_at', value: 'whenever' });
    await db.insert(settings).values({ key: 'group_buy_schedule_closes_at', value: 'whenever' });
    expect(await isGroupBuyOpenNow()).toBe(false);
  });
});
