// The sweep's status transitions must be guarded conditional UPDATEs, not
// read-then-write: the WHERE re-checks status, deadline and viability so a
// stale decision (a checkout raced the sweep and pushed the hatian to 7)
// transitions nothing and releases nobody. PGlite is single-connection, so the
// race itself cannot run here — these tests drive the transition function with
// a deliberately stale premise instead.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

const { cancelExpiredKahati, sweepExpiredKahatis } = await import('./kahati-server');
const { getDb, groupBuys, orders } = await import('@/lib/db');
const { resetDb, makeGroupBuy } = await import('@/lib/test/harness');

const HOUR = 60 * 60 * 1000;
const past = () => new Date(Date.now() - HOUR);

async function statusOf(id: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row.status;
}

beforeEach(async () => {
  await resetDb();
});

describe('guarded cancel transition', () => {
  it('cancels an expired hatian that is still short of the minimum', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 6, minVials: 1, closesAt: past() });
    const db = await getDb();

    const result = await cancelExpiredKahati(db, gb.id, new Date());

    expect(result).not.toBeNull();
    expect(await statusOf(gb.id)).toBe('cancelled');
  });

  it('refuses to cancel a hatian that turned viable after being selected', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 6, minVials: 1, closesAt: past() });
    const db = await getDb();
    // A racing checkout pushed it to the 7-vial minimum between the sweep's
    // read and its cancel transition.
    await db.update(groupBuys).set({ claimedSlots: 7 }).where(eq(groupBuys.id, gb.id));

    const result = await cancelExpiredKahati(db, gb.id, new Date());

    expect(result).toBeNull();
    expect(await statusOf(gb.id)).toBe('open'); // the next sweep closes it as viable
  });

  it('refuses to cancel a hatian another sweep already resolved', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 6, minVials: 1, closesAt: past() });
    const db = await getDb();
    await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, gb.id));

    const result = await cancelExpiredKahati(db, gb.id, new Date());

    expect(result).toBeNull();
    expect(await statusOf(gb.id)).toBe('closed');
  });

  it('releases no orders when the guard loses', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 7, minVials: 1, closesAt: past() });
    const db = await getDb();

    const result = await cancelExpiredKahati(db, gb.id, new Date());

    expect(result).toBeNull();
    expect(await db.select().from(orders)).toHaveLength(0);
  });
});

describe('sweep resolves by the guarded transitions', () => {
  it('closes — never cancels — an expired hatian that reached the minimum', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 7, minVials: 1, closesAt: past() });
    const db = await getDb();

    const result = await sweepExpiredKahatis(db);

    expect(result.closed).toContain(gb.id);
    expect(result.cancelled).not.toContain(gb.id);
    expect(await statusOf(gb.id)).toBe('closed');
  });
});
