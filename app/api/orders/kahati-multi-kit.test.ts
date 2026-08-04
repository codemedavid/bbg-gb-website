// A kahati commitment may exceed one kit.
//
// Client rule: a counter still holds exactly 10 vials, but a customer must not be
// stopped at 10. Committing 25 vials fills this counter to its cap, seals it,
// opens a fresh one, fills that, and keeps going until the whole commitment has
// landed — every counter capped at 10, never one at 11, never a rejected order.
//
// This is the sibling rule to kahati-overflow.test.ts, which covers a commitment
// that spills into exactly one successor. Here the spill spans several kits.
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

const { POST } = await import('./route');
const { getDb, groupBuys, orders, orderItems } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');

beforeEach(async () => {
  session.current = null;
  const user = await resetDb().then(() => makeUser({ role: 'customer' }));
  await openBoards();
  session.current = { sub: user.id, role: 'customer', email: user.email };
});

describe('kahati commitment larger than one full kit', () => {
  it('spans as many 10-vial counters as the commitment needs', async () => {
    // 7/10 claimed → 3 open. Commit 25: 3 here, then 10, then 10, then 2.
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 7, minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150, name: 'Reta 20mg' });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 25 }]));
    expect(res.status).toBe(201);

    const db = await getDb();
    const all = await db.select().from(groupBuys);
    // The counter joined plus three successors — 7+25 = 32 vials needs four kits.
    expect(all).toHaveLength(4);
    // The 10-vial rule survives the larger commitment: no counter holds 11.
    expect(all.every((g) => g.claimedSlots <= g.totalSlots)).toBe(true);
    expect(all.filter((g) => g.status === 'closed').map((g) => g.claimedSlots)).toEqual([10, 10, 10]);

    // Exactly one counter is left open, carrying the remainder, so the next
    // customer has somewhere to join.
    const open = all.filter((g) => g.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ name: 'Reta 20mg', totalSlots: 10, claimedSlots: 2 });
  });

  it('records every fragment against the counter it claimed from, under one order', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 7, minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 25 }]));
    expect(res.status).toBe(201);

    const db = await getDb();
    const kahatiOrders = (await db.select().from(orders)).filter((o) => o.buyType === 'kahati');
    // One commitment is one order however many counters it spans, and the hatian
    // parcel is still billed a single packing fee at settlement — not one per kit.
    expect(kahatiOrders).toHaveLength(1);
    expect(Number(kahatiOrders[0].packingFeePhp)).toBe(0);
    expect(Number(kahatiOrders[0].subtotalPhp)).toBe(25 * 900);

    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, kahatiOrders[0].id));
    expect(lines.map((l) => l.qty).sort((a, b) => a - b)).toEqual([2, 3, 10, 10]);
    // Each fragment points at a distinct counter, so a later cancellation refunds
    // against the right one.
    expect(new Set(lines.map((l) => l.groupBuyId)).size).toBe(4);
  });

  it('leaves a fresh empty counter open when the commitment lands exactly on the cap', async () => {
    // 20 vials into an empty counter: two kits fill exactly, and the board must
    // still end with somewhere to join rather than only sealed counters.
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 20 }]));
    expect(res.status).toBe(201);

    const db = await getDb();
    const all = await db.select().from(groupBuys);
    expect(all.filter((g) => g.status === 'closed').map((g) => g.claimedSlots)).toEqual([10, 10]);
    const open = all.filter((g) => g.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].claimedSlots).toBe(0);

    const [order] = (await db.select().from(orders)).filter((o) => o.buyType === 'kahati');
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines.map((l) => l.qty)).toEqual([10, 10]);
  });

  it('no longer rejects a commitment for being larger than a single kit', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 11 }]));

    expect(res.status).toBe(201);
    const db = await getDb();
    const claimed = (await db.select().from(groupBuys)).reduce((sum, g) => sum + g.claimedSlots, 0);
    expect(claimed).toBe(11);
  });

  it('still enforces the per-person minimum', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 3, pricePerKitPhp: 9000, repackFeePhp: 150 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }]));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/minimum kahati commitment is 3 vials/i);
  });

  it('refuses to spill into a counter whose deadline has passed', async () => {
    // The successor inherits its parent's window. A parent already past its
    // deadline yields a zero-length window, so the spill must be rejected rather
    // than parked in a counter nobody can join.
    const past = new Date(Date.now() - 60_000);
    const gb = await makeGroupBuy({
      totalSlots: 10, claimedSlots: 8, minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150,
      closesAt: past,
    });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 12 }]));

    expect(res.status).toBe(400);
    const db = await getDb();
    // Nothing was claimed: the whole transaction rolled back.
    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, gb.id));
    expect(row.claimedSlots).toBe(8);
  });
});
