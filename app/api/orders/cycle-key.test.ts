// Which trading cycle an order belongs to.
//
// The packing fee is charged once per Group Buy/Hatian cycle, which is only
// answerable if an order records the cycle it was placed in. A timestamp is not
// enough: working out the cycle from created_at means re-deriving it against
// whatever recurrence is configured TODAY, so an admin moving the schedule would
// silently re-bill customers for cycles that already happened. The cycle is
// stamped once, at checkout, and never recomputed.
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
    requireAdmin: async () => requireSession(),
  };
});

const { POST } = await import('./route');
const {
  resetDb, makeUser, makeProduct, makeGroupBuy, makeMoqCampaign, makePaymentMethod,
  checkoutRequest, commitRequest, openBoards,
} = await import('@/lib/test/harness');
const { getDb, orders } = await import('@/lib/db');
const { getCurrentCycle } = await import('@/lib/settings');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const placedOrders = async () => (await (await getDb()).select().from(orders));

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
  await makePaymentMethod();
});

describe('the cycle an order was placed in', () => {
  it('stamps a hatian commitment with the running cycle', async () => {
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });

    await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }]));

    const cycle = await getCurrentCycle();
    const [order] = await placedOrders();
    expect(order.cycleKey).toBe(cycle!.opensAt);
  });

  it('stamps a group buy commitment with the same cycle', async () => {
    // One schedule, two boards — so one cycle key, or the fee could be charged
    // once on each board in what the customer experiences as one week.
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });

    await POST(commitRequest(c.id, 1));

    const cycle = await getCurrentCycle();
    const [order] = await placedOrders();
    expect(order.cycleKey).toBe(cycle!.opensAt);
  });

  it('gives two orders in one cycle the same key', async () => {
    // The whole point: this is what "already paid this cycle" is looked up by.
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });
    const c = await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });

    await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 1 }]));
    await POST(commitRequest(c.id, 1));

    const keys = (await placedOrders()).map((o) => o.cycleKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('leaves an on-hand order unstamped', async () => {
    // On-hand stock is not gated by the schedule and ships as its own parcel,
    // so it belongs to no cycle and must not satisfy a cycle's packing fee.
    await signIn();
    const p = await makeProduct({ isOnHand: true, onHandPiecePhp: 1200, stock: 10 });

    await POST(checkoutRequest([{ kind: 'product', refId: p.id, qty: 1 }]));

    const [order] = await placedOrders();
    expect(order.cycleKey).toBeNull();
  });

  it('splits a mixed cart so only the gated order carries the cycle', async () => {
    // Modes never share an order. The on-hand half is not part of the cycle;
    // the hatian half is.
    await signIn();
    const p = await makeProduct({ isOnHand: true, onHandPiecePhp: 1200, stock: 10 });
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });

    await POST(checkoutRequest([
      { kind: 'product', refId: p.id, qty: 1 },
      { kind: 'group_buy', refId: gb.id, qty: 1 },
    ]));

    const rows = await placedOrders();
    expect(rows).toHaveLength(2);
    const byType = new Map(rows.map((o) => [o.buyType, o.cycleKey]));
    expect(byType.get('solo')).toBeNull();
    expect(byType.get('kahati')).toBe((await getCurrentCycle())!.opensAt);
  });
});
