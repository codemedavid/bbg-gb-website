// Integration tests for the public kahati board: it lazily resolves expired
// counters on read (cancel unfilled, close full) and lists only open ones.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

const { GET } = await import('./route');
const { getDb, groupBuys } = await import('@/lib/db');
const { resetDb, makeGroupBuy } = await import('@/lib/test/harness');

const DAY = 24 * 60 * 60 * 1000;
const past = () => new Date(Date.now() - DAY);
const future = () => new Date(Date.now() + DAY);

beforeEach(async () => {
  await resetDb();
});

async function statusOf(id: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row.status;
}

describe('GET /api/groupbuys', () => {
  it('lists only open counters and hides closed/cancelled ones', async () => {
    const open = await makeGroupBuy({ name: 'Open one', closesAt: future(), claimedSlots: 3 });
    await makeGroupBuy({ name: 'Closed one', status: 'closed' });

    const body = await (await GET()).json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(open.id);
  });

  it('cancels an expired counter that never reached the 10-vial cap', async () => {
    const stale = await makeGroupBuy({ totalSlots: 10, claimedSlots: 6, closesAt: past() });

    const body = await (await GET()).json();

    expect(body.data).toHaveLength(0);          // hidden from the board
    expect(await statusOf(stale.id)).toBe('cancelled');
  });

  it('closes (not cancels) an expired counter that is already at the cap', async () => {
    const full = await makeGroupBuy({ totalSlots: 10, claimedSlots: 10, closesAt: past() });

    await GET();

    expect(await statusOf(full.id)).toBe('closed');
  });

  it('leaves a counter open when its deadline has not passed', async () => {
    const live = await makeGroupBuy({ totalSlots: 10, claimedSlots: 4, closesAt: future() });

    const body = await (await GET()).json();

    expect(body.data).toHaveLength(1);
    expect(await statusOf(live.id)).toBe('open');
  });
});
