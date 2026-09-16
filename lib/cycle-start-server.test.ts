// Starting a cycle by hand — the operation behind both "Start new cycle"
// buttons and scripts/start-cycle.ts.
//
// The 2026-09-10 bug: the schedule was paused for a month, an admin pressed
// "Start new cycle", every listing rolled, and customers still saw a closed
// board — because the button only rolled listings and never touched the gate.
// A manual cycle must OPEN the boards, override the pause, name itself so the
// orders and listings file under it, and claim itself so the next board read
// does not roll everything a second time.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, groupBuys, moqCampaigns, settings } from '@/lib/db';
import { resetDb, makeGroupBuy, makeMoqCampaign, makeProduct, openBoards } from '@/lib/test/harness';
import {
  getCurrentCycle, getLatestCycleKey, getSchedulePausedUntil, isGroupBuyOpenNow,
  setScheduleRecurrence, setSchedulePausedUntil,
} from '@/lib/settings';
import { refreshBoardsForNewCycle, BOARDS_REFRESHED_KEY } from '@/lib/cycle-boundary-server';
import { startCycleNow } from '@/lib/cycle-start-server';

beforeEach(resetDb);

const DAY = 86_400_000;

/** Production's posture on 2026-09-10: a weekend schedule, paused for a month. */
async function pausedWeekendSchedule(now: Date): Promise<void> {
  await setScheduleRecurrence({ openDay: 6, openTime: '04:00', closeDay: 0, closeTime: '23:00' });
  await setSchedulePausedUntil(new Date(now.getTime() + 30 * DAY).toISOString());
}

describe('startCycleNow', () => {
  it('opens both boards at once, overriding a paused schedule', async () => {
    const now = new Date('2026-09-10T02:00:00.000Z'); // a Thursday, boards dark
    await pausedWeekendSchedule(now);
    expect(await isGroupBuyOpenNow(now)).toBe(false);
    const db = await getDb();

    const result = await startCycleNow(db, now);

    expect(await isGroupBuyOpenNow(now)).toBe(true);
    expect(await getSchedulePausedUntil()).toBeNull();
    expect(result.cycle).toEqual({
      cycleKey: now.toISOString(),
      opensAt: now.toISOString(),
      // The next scheduled opening: Sat 12 Sep 04:00 PHT.
      closesAt: '2026-09-11T20:00:00.000Z',
    });
    expect(await getCurrentCycle(now)).toMatchObject({ opensAt: now.toISOString(), source: 'manual' });
  });

  it('seals joined listings under the old cycle and files their successors under the new one', async () => {
    const now = new Date('2026-09-10T02:00:00.000Z');
    await pausedWeekendSchedule(now);
    const db = await getDb();
    const OLD = '2026-09-04T20:00:00.000Z';
    const joined = await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 4 });
    const empty = await makeGroupBuy({ name: 'Idle', totalSlots: 10, claimedSlots: 0 });
    const batch = await makeMoqCampaign({ moq: 10, committed: 3 });
    await db.update(groupBuys).set({ cycleKey: OLD });
    await db.update(moqCampaigns).set({ cycleKey: OLD });

    const result = await startCycleNow(db, now);

    expect(result.kahati.rolled).toHaveLength(1);
    expect(result.campaigns.rolled).toHaveLength(1);
    const counters = await db.select().from(groupBuys);
    const sealed = counters.find((c) => c.id === joined.id)!;
    const successor = counters.find((c) => c.name === 'KLOW 80mg' && c.id !== joined.id)!;
    expect(sealed).toMatchObject({ status: 'closed', cycleKey: OLD });
    expect(successor).toMatchObject({ status: 'open', claimedSlots: 0, cycleKey: now.toISOString() });
    // An empty counter is this cycle's now, too — it is what customers can join.
    expect(counters.find((c) => c.id === empty.id)).toMatchObject({ cycleKey: now.toISOString() });
    const batches = await db.select().from(moqCampaigns);
    expect(batches.find((b) => b.id === batch.id)).toMatchObject({ status: 'approved', cycleKey: OLD });
    expect(batches.find((b) => b.batchNo === 2)).toMatchObject({ status: 'open', cycleKey: now.toISOString() });
    expect(await getLatestCycleKey(now)).toBe(now.toISOString());
  });

  it('claims the cycle so the first board read does not roll everything again', async () => {
    const now = new Date('2026-09-10T02:00:00.000Z');
    await pausedWeekendSchedule(now);
    const db = await getDb();
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 4 });

    await startCycleNow(db, now);
    // A customer joins the successor, then the board is read again.
    await db.update(groupBuys).set({ claimedSlots: 2 }).where(eq(groupBuys.status, 'open'));
    const refresh = await refreshBoardsForNewCycle(db, now);

    expect(refresh.refreshed).toBe(false);
    const [claim] = await db.select().from(settings).where(eq(settings.key, BOARDS_REFRESHED_KEY));
    expect(claim.value).toBe(now.toISOString());
    expect((await db.select().from(groupBuys).where(eq(groupBuys.status, 'open')))[0].claimedSlots).toBe(2);
  });

  it('puts every flagged product on both boards', async () => {
    const now = new Date('2026-09-10T02:00:00.000Z');
    await pausedWeekendSchedule(now);
    const db = await getDb();
    await makeProduct({ name: 'Retatrutide', isKahati: true, isGroupBuy: true });

    await startCycleNow(db, now);

    expect(await db.select().from(groupBuys).where(eq(groupBuys.status, 'open'))).toHaveLength(1);
    expect(await db.select().from(moqCampaigns).where(eq(moqCampaigns.status, 'open'))).toHaveLength(1);
  });

  it('ends a running scheduled cycle early and keeps its close', async () => {
    await openBoards();
    const now = new Date();
    const scheduled = (await getCurrentCycle(now))!;
    const db = await getDb();

    const result = await startCycleNow(db, new Date(now.getTime() + 1000));

    expect(result.cycle.closesAt).toBe(scheduled.closesAt);
    expect(result.cycle.cycleKey).not.toBe(scheduled.opensAt);
    expect(await getLatestCycleKey(new Date(now.getTime() + 2000))).toBe(result.cycle.cycleKey);
  });

  it('opens the boards for the default span when no schedule is set', async () => {
    const now = new Date('2026-09-10T02:00:00.000Z');
    const db = await getDb();
    expect(await isGroupBuyOpenNow(now)).toBe(false);

    await startCycleNow(db, now);

    expect(await isGroupBuyOpenNow(now)).toBe(true);
    expect(await isGroupBuyOpenNow(new Date(now.getTime() + 6 * DAY))).toBe(true);
    expect(await isGroupBuyOpenNow(new Date(now.getTime() + 8 * DAY))).toBe(false);
  });
});
