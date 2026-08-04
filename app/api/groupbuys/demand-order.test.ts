// The public hatian board serves its counters in demand order.
//
// lib/kahati-demand-sort.test.ts pins the rule; this pins that the board
// actually applies it, and that it applies it to the DISPLAYED vial count. A
// legacy row stored over its cap shows 10/10 but holds 13 — sorting on the
// stored number would rank it above a genuine 10/10, on strength of vials the
// board is not even showing.
import { describe, it, expect, beforeEach } from 'vitest';

const { GET } = await import('./route');
const { setGroupBuySchedule } = await import('@/lib/settings');
const { resetDb, makeGroupBuy } = await import('@/lib/test/harness');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await resetDb();
  // The board is gated by the shared schedule, so every test here opens it.
  await setGroupBuySchedule({
    opensAt: new Date(Date.now() - HOUR).toISOString(),
    closesAt: new Date(Date.now() + HOUR).toISOString(),
  });
});

const namesOf = async (): Promise<string[]> => {
  const body = await (await GET()).json();
  return body.data.map((g: { name: string }) => g.name);
};

describe('GET /api/groupbuys ordering', () => {
  it('lists the counters closest to completion first', async () => {
    await makeGroupBuy({ name: 'Product D', totalSlots: 10, claimedSlots: 3, closesAt: new Date(Date.now() + DAY) });
    await makeGroupBuy({ name: 'Product A', totalSlots: 10, claimedSlots: 9, closesAt: new Date(Date.now() + DAY) });
    await makeGroupBuy({ name: 'Product E', totalSlots: 10, claimedSlots: 0, closesAt: new Date(Date.now() + DAY) });
    await makeGroupBuy({ name: 'Product B', totalSlots: 10, claimedSlots: 8, closesAt: new Date(Date.now() + DAY) });
    await makeGroupBuy({ name: 'Product C', totalSlots: 10, claimedSlots: 6, closesAt: new Date(Date.now() + DAY) });

    expect(await namesOf()).toEqual(['Product A', 'Product B', 'Product C', 'Product D', 'Product E']);
  });

  it('still hides completed and cancelled counters from the board', async () => {
    // Demand order must not quietly resurrect a batch that is over. A cancelled
    // counter at 9 vials would otherwise sort straight to the top.
    await makeGroupBuy({ name: 'Live', totalSlots: 10, claimedSlots: 2, closesAt: new Date(Date.now() + DAY) });
    await makeGroupBuy({ name: 'Done', totalSlots: 10, claimedSlots: 9, status: 'completed' });
    await makeGroupBuy({ name: 'Scrapped', totalSlots: 10, claimedSlots: 9, status: 'cancelled' });

    expect(await namesOf()).toEqual(['Live']);
  });

  it('ranks an over-cap legacy row on the vials it displays, not the vials it stored', async () => {
    const db = (await import('@/lib/db')).getDb;
    const { groupBuys } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');

    const legacy = await makeGroupBuy({ name: 'Legacy', totalSlots: 10, claimedSlots: 10, closesAt: new Date(Date.now() + DAY) });
    // Write past the cap the way a pre-constraint row was written.
    await (await db()).update(groupBuys).set({ totalSlots: 13, claimedSlots: 13 }).where(eq(groupBuys.id, legacy.id));
    await makeGroupBuy({ name: 'Genuine', totalSlots: 10, claimedSlots: 10, closesAt: new Date(Date.now() + DAY) });

    const names = await namesOf();

    // Both display 10 vials, so the earlier-created one leads. The legacy row's
    // stored 13 must not buy it the top slot.
    expect(names[0]).toBe('Legacy');
    expect(names).toEqual(['Legacy', 'Genuine']);
  });
});
