// Kahati overflow roll-over.
//
// Client rule: "pag napuno ang 10 vials dapat mag-reset ulit sa panibago; pag
// sumubra na sa 10, [huwag] na-stock sya sa 10." A commitment larger than the
// current counter's remaining vials must fill this counter to its cap (which
// closes it and auto-opens a fresh sibling) and roll the remainder into that
// sibling — never reject the excess, never push a counter past 10.
//
// The customer made ONE placement, so it still carries ONE packing fee even
// though it lands in two counters (two order lines, shared placementKey).
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
const { resetDb, makeUser, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');

beforeEach(async () => {
  session.current = null;
  const user = await resetDb().then(() => makeUser({ role: 'customer' }));
  session.current = { sub: user.id, role: 'customer', email: user.email };
});

describe('kahati commitment larger than the counter’s remaining vials', () => {
  it('fills the current counter to the cap and rolls the overflow into a fresh sibling', async () => {
    // 7/10 already claimed → 3 vials open. Commit 5.
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 7, minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150, name: 'Reta 20mg' });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 5 }]));
    expect(res.status).toBe(201);

    const db = await getDb();
    const [filled] = await db.select().from(groupBuys).where(eq(groupBuys.id, gb.id));
    // Current counter is capped at 10 and closed — the reset the client asked for.
    expect(filled).toMatchObject({ status: 'closed', claimedSlots: 10 });

    const siblings = (await db.select().from(groupBuys)).filter((g) => g.id !== gb.id);
    expect(siblings).toHaveLength(1);
    // The 2-vial remainder rolled into the fresh sibling — not lost, not rejected.
    expect(siblings[0]).toMatchObject({ name: 'Reta 20mg', totalSlots: 10, claimedSlots: 2, status: 'open' });
  });

  it('records the split as two order lines but charges a single packing fee', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 7, minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 5 }]));
    const body = await res.json();
    expect(res.status).toBe(201);

    const db = await getDb();
    const kahatiOrders = (await db.select().from(orders)).filter((o) => o.buyType === 'kahati');
    expect(kahatiOrders).toHaveLength(1);
    const order = kahatiOrders[0];

    // One placement → one packing fee, even though the vials landed in two counters.
    expect(Number(order.packingFeePhp)).toBe(150);
    // 5 vials × ₱900/vial + one ₱150 packing fee.
    expect(Number(order.subtotalPhp)).toBe(4500);
    expect(Number(order.totalPhp)).toBe(4650);

    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.qty).sort()).toEqual([2, 3]);
    // Each fragment points at the counter it actually claimed from, so a later
    // cancellation refunds against the right counter.
    const siblingId = (await db.select().from(groupBuys)).find((g) => g.id !== gb.id)!.id;
    expect(new Set(lines.map((l) => l.groupBuyId))).toEqual(new Set([gb.id, siblingId]));
  });

  it('still places a normal within-capacity commitment as a single line', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 6 }]));
    expect(res.status).toBe(201);

    const db = await getDb();
    expect(await db.select().from(groupBuys)).toHaveLength(1); // no sibling
    const [order] = (await db.select().from(orders)).filter((o) => o.buyType === 'kahati');
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines).toHaveLength(1);
    expect(Number(order.packingFeePhp)).toBe(150);
  });
});
