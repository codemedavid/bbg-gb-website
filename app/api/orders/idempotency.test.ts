// Checkout idempotency: resubmitting the same checkout (refresh mid-submit,
// double tap, two tabs) must not create duplicate orders or double-claim
// vials. The client sends one idempotency key per submission; the server
// stores it per created order (`${key}:${splitIndex}`, unique) so an
// intentional cart split still creates its several orders, while a replay
// returns the original success payload instead of writing new rows.
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
const { getDb, groupBuys, orders, products } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

beforeEach(async () => {
  await resetDb();
  const user = await makeUser();
  session.current = { sub: user.id, role: 'customer', email: user.email };
});

describe('checkout idempotency key', () => {
  it('a resubmitted checkout returns the original order instead of creating a duplicate', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const item = [{ kind: 'group_buy', refId: gb.id, qty: 3 }];
    const key = 'aaaaaaaa-1111-2222-3333-444444444444';

    const first = await POST(checkoutRequest(item, { idempotencyKey: key }));
    const second = await POST(checkoutRequest(item, { idempotencyKey: key }));
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(201);
    expect(secondBody.success).toBe(true);
    expect(secondBody.data.orderNo).toBe(firstBody.data.orderNo);

    const db = await getDb();
    expect(await db.select().from(orders)).toHaveLength(1);
    const [g] = await db.select().from(groupBuys).where(eq(groupBuys.id, gb.id));
    expect(g.claimedSlots).toBe(3); // vials claimed once, not twice
  });

  it('a split cart keeps its several orders and replays them all under one key', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const p = await makeProduct({ stock: 20 });
    const items = [
      { kind: 'group_buy', refId: gb.id, qty: 2 },
      { kind: 'product', refId: p.id, qty: 3, unit: 'piece' },
    ];
    const key = 'bbbbbbbb-1111-2222-3333-444444444444';

    const first = await POST(checkoutRequest(items, { idempotencyKey: key }));
    const firstBody = await first.json();
    expect(first.status).toBe(201);
    expect(firstBody.data.orders).toHaveLength(2);

    const second = await POST(checkoutRequest(items, { idempotencyKey: key }));
    const secondBody = await second.json();

    expect(secondBody.success).toBe(true);
    const firstNos = firstBody.data.orders.map((o: { orderNo: string }) => o.orderNo).sort();
    const secondNos = secondBody.data.orders.map((o: { orderNo: string }) => o.orderNo).sort();
    expect(secondNos).toEqual(firstNos);

    const db = await getDb();
    expect(await db.select().from(orders)).toHaveLength(2); // still just the split pair
    const [stock] = await db.select().from(products).where(eq(products.id, p.id));
    expect(stock.stock).toBe(17); // drawn once
  });

  it('distinct keys still place distinct orders', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const item = [{ kind: 'group_buy', refId: gb.id, qty: 2 }];

    await POST(checkoutRequest(item, { idempotencyKey: 'cccccccc-1111-2222-3333-444444444444' }));
    await POST(checkoutRequest(item, { idempotencyKey: 'dddddddd-1111-2222-3333-444444444444' }));

    const db = await getDb();
    expect(await db.select().from(orders)).toHaveLength(2);
    const [g] = await db.select().from(groupBuys).where(eq(groupBuys.id, gb.id));
    expect(g.claimedSlots).toBe(4);
  });

  it('a checkout without a key keeps working as before', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }]));

    expect(res.status).toBe(201);
  });
});
