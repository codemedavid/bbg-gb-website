// A full hatian never stays full, and never goes past full.
//
// Client rule: a kahati kit holds 10 vials. 11/10, 12/10 and 13/10 must be
// unreachable, and the moment a counter reaches 10/10 it is sealed and a fresh
// counter opens at 0/10 — so the next customer's 3 vials read 3/10, not 13/10.
//
// Before this file, sealing only ever happened as a SIDE EFFECT of a checkout or
// an admin edit. A counter that filled and was then left alone — which is the
// state production row 1c16204f sat in for three days — stayed 'open' at 10/10
// with no successor, because the only sweep keyed off the DEADLINE, not the cap.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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
    ApiError, getSession: async () => session.current, requireSession,
    requireAdmin: async () => requireSession(),
  };
});

const { sweepKahatis } = await import('./kahati-server');
const { POST: placeOrder } = await import('@/app/api/orders/route');
const { GET: publicBoard } = await import('@/app/api/groupbuys/route');
const { getDb, groupBuys } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');

const DAY = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + DAY);

type Counter = typeof groupBuys.$inferSelect;

// Every counter of one hatian series, oldest first.
async function countersNamed(name: string): Promise<Counter[]> {
  const db = await getDb();
  return db.select().from(groupBuys).where(eq(groupBuys.name, name)).orderBy(groupBuys.createdAt);
}

async function join(groupBuyId: string, qty: number) {
  const user = await makeUser();
  session.current = { sub: user.id, role: 'customer', email: user.email };
  const res = await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: groupBuyId, qty }]));
  const body = await res.json();
  if (res.status !== 201) throw new Error(`join failed: ${body.error}`);
  return body;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('sweepKahatis — a full counter seals itself and opens a successor', () => {
  it('seals a 10/10 open counter whose deadline has NOT passed, and opens a fresh 0/10', async () => {
    // Exactly production row 1c16204f: filled to the cap, still open, deadline days away.
    const full = await makeGroupBuy({
      name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 10, closesAt: future(),
    });

    const db = await getDb();
    const result = await sweepKahatis(db);

    expect(result.rolled).toEqual([full.id]);

    const [sealed, successor] = await countersNamed('KLOW 80mg');
    expect(sealed.id).toBe(full.id);
    expect(sealed.status).toBe('closed');
    expect(successor).toBeDefined();
    expect(successor.status).toBe('open');
    expect(successor.claimedSlots).toBe(0);
    expect(successor.totalSlots).toBe(10);
  });

  it('leaves a counter with room alone', async () => {
    const partial = await makeGroupBuy({ totalSlots: 10, claimedSlots: 9, closesAt: future() });

    const db = await getDb();
    const result = await sweepKahatis(db);

    expect(result.rolled).toEqual([]);
    expect((await countersNamed('Test Kahati'))).toHaveLength(1);
  });

  it('is idempotent — a second sweep does not open a third counter', async () => {
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 10, closesAt: future() });

    const db = await getDb();
    await sweepKahatis(db);
    const second = await sweepKahatis(db);

    expect(second.rolled).toEqual([]);
    expect(await countersNamed('KLOW 80mg')).toHaveLength(2);
  });

  it('the successor inherits price, cap, minimum, packing fee and deadline window', async () => {
    const full = await makeGroupBuy({
      name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 10, minVials: 2,
      pricePerKitPhp: 9500, repackFeePhp: 175, closesAt: future(),
    });

    const db = await getDb();
    await sweepKahatis(db);

    const [, successor] = await countersNamed('KLOW 80mg');
    expect(Number(successor.pricePerKitPhp)).toBe(9500);
    expect(Number(successor.repackFeePhp)).toBe(175);
    expect(successor.minVials).toBe(2);
    expect(successor.closesAt).not.toBeNull();
    expect(successor.closesAt!.getTime()).toBeGreaterThan(Date.now());
    void full;
  });

  it('an expired UNFILLED counter is still cancelled — the deadline rule is not lost', async () => {
    const stale = await makeGroupBuy({
      totalSlots: 10, claimedSlots: 2, closesAt: new Date(Date.now() - DAY),
    });

    const db = await getDb();
    const result = await sweepKahatis(db);

    expect(result.cancelled).toEqual([stale.id]);
    expect(result.rolled).toEqual([]);
  });
});

describe('the public board never offers a counter with no room', () => {
  it('drops the filled counter and lists its fresh successor instead', async () => {
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 10, closesAt: future() });

    const body = await (await publicBoard()).json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].claimedSlots).toBe(0);
    expect(body.data[0].remaining).toBe(10);
  });
});

describe('committing against a full counter opens the next one — never 13/10', () => {
  it('10/10 + 3 vials lands 3/10 in a fresh counter, and nothing reads past the cap', async () => {
    const full = await makeGroupBuy({
      name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 10, minVials: 1, closesAt: future(),
    });

    await join(full.id, 3);

    const counters = await countersNamed('KLOW 80mg');
    expect(counters).toHaveLength(2);
    expect(counters[0].claimedSlots).toBe(10);
    expect(counters[0].status).toBe('closed');
    expect(counters[1].claimedSlots).toBe(3);
    expect(counters[1].status).toBe('open');
    for (const c of counters) expect(c.claimedSlots).toBeLessThanOrEqual(c.totalSlots);
  });

  it('8/10 + 5 vials seals the first at 10/10 and carries 3 into the successor', async () => {
    const partial = await makeGroupBuy({
      name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 8, minVials: 1, closesAt: future(),
    });

    await join(partial.id, 5);

    const counters = await countersNamed('KLOW 80mg');
    expect(counters.map((c) => [c.claimedSlots, c.status])).toEqual([
      [10, 'closed'],
      [3, 'open'],
    ]);
  });
});

describe('the database itself refuses an over-full counter', () => {
  it('rejects an UPDATE pushing claimed_slots past total_slots', async () => {
    const g = await makeGroupBuy({ totalSlots: 10, claimedSlots: 8, closesAt: future() });
    const db = await getDb();

    await expect(
      db.update(groupBuys).set({ claimedSlots: 13 }).where(eq(groupBuys.id, g.id)),
    ).rejects.toThrow();

    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, g.id));
    expect(row.claimedSlots).toBe(8);
  });
});
