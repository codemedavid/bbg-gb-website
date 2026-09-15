// Integration tests for the public settings endpoint the storefront reads
// before checkout (packing-fee defaults + kahati downpayment).
import { describe, it, expect, beforeEach } from 'vitest';

const { GET } = await import('./route');
const { resetDb, openBoards } = await import('@/lib/test/harness');
const { getCurrentCycle } = await import('@/lib/settings');
const { cycleKeyOf } = await import('@/lib/schedule-recurrence');

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/settings', () => {
  it('returns the packing-fee defaults without auth', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.packingFees).toEqual({ solo: 200, kahati: 150, group_buy: 300, moq: 200 });
  });

  // My Orders labels each batch Ongoing or Done. The page cannot work out which
  // cycle is trading on its own - that depends on the schedule, a manual start
  // and the pause - so it is told, by the same resolver checkout stamps with.
  it('names the cycle still trading and when it closes', async () => {
    await openBoards();
    const cycle = await getCurrentCycle();

    const body = await (await GET()).json();

    expect(body.data.currentCycle).toEqual({ key: cycleKeyOf(cycle!), closesAt: cycle!.closesAt });
  });
});
