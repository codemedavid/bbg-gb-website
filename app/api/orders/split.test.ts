// Mixed carts must check out as one order per purchase mode.
//
// lib/order-modes.ts states the rule and has passing tests, but nothing ever
// imported splitCartIntoOrders — so a cart holding both on-hand and kahati lines
// collapsed into a single order that claimed one buyType and summed both packing
// fees into it. A customer buying ready stock plus a hatian vial was charged the
// solo fee AND the kahati fee on one order, and that order then carried a single
// lifecycle for two things that ship on completely different timelines.
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
const { resetDb, makeUser, makeProduct, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('mixed cart splits into one order per mode', () => {
  it('creates a separate order for the on-hand lines and the kahati lines', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const gb = await makeGroupBuy({ pricePerKitPhp: 9000, repackFeePhp: 150, minVials: 1 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 2, unit: 'piece' },
      { kind: 'group_buy', refId: gb.id, qty: 1 },
    ]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.orders).toHaveLength(2);
    expect(body.data.orders.map((o: { order: { buyType: string } }) => o.order.buyType).sort())
      .toEqual(['kahati', 'solo']);
  });

  it('gives each split order its own invoice number', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const gb = await makeGroupBuy({ minVials: 1 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
      { kind: 'group_buy', refId: gb.id, qty: 1 },
    ]));
    const body = await res.json();

    const nos = body.data.orders.map((o: { orderNo: string }) => o.orderNo);
    expect(new Set(nos).size).toBe(2);
  });

  it('charges each mode its own packing fee instead of stacking both on one order', async () => {
    await signIn();
    // solo packing fee defaults to 200; this hatian's repack fee is 150.
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const gb = await makeGroupBuy({ pricePerKitPhp: 9000, repackFeePhp: 150, minVials: 1 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 2, unit: 'piece' },
      { kind: 'group_buy', refId: gb.id, qty: 1 },
    ]));
    const body = await res.json();

    const byMode = Object.fromEntries(
      body.data.orders.map((o: { order: { buyType: string }; totals: { packingFee: number } }) =>
        [o.order.buyType, o.totals.packingFee]),
    );
    expect(byMode.solo).toBe(200);
    expect(byMode.kahati).toBe(150);
  });

  it('keeps each order total to its own lines', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const gb = await makeGroupBuy({ pricePerKitPhp: 9000, repackFeePhp: 150, minVials: 1 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 2, unit: 'piece' },
      { kind: 'group_buy', refId: gb.id, qty: 1 },
    ]));
    const body = await res.json();

    const byMode = Object.fromEntries(
      body.data.orders.map((o: { order: { buyType: string }; totals: { subtotal: number; total: number } }) =>
        [o.order.buyType, o.totals]),
    );
    // 2 x 550 on-hand, + its own 200 fee
    expect(byMode.solo).toMatchObject({ subtotal: 1100, total: 1300 });
    // one vial of a 9000 kit = 900, + its own 150 fee
    expect(byMode.kahati).toMatchObject({ subtotal: 900, total: 1050 });
  });

  it('puts only the kahati downpayment on the kahati order', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const gb = await makeGroupBuy({ pricePerKitPhp: 9000, repackFeePhp: 150, minVials: 1 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 2, unit: 'piece' },
      { kind: 'group_buy', refId: gb.id, qty: 1 },
    ]));
    const body = await res.json();

    const byMode = Object.fromEntries(
      body.data.orders.map((o: { order: { buyType: string; downpaymentPhp: string } }) =>
        [o.order.buyType, Number(o.order.downpaymentPhp)]),
    );
    // On-hand is paid in full; only the reservation carries a downpayment.
    expect(byMode.solo).toBe(0);
    expect(byMode.kahati).toBeGreaterThan(0);
  });

  it('files each line under the order for its own mode', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const gb = await makeGroupBuy({ minVials: 1 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
      { kind: 'group_buy', refId: gb.id, qty: 1 },
    ]));
    const body = await res.json();

    const { getDb, orderItems } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();

    for (const entry of body.data.orders as { order: { id: string; buyType: string } }[]) {
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, entry.order.id));
      expect(items).toHaveLength(1);
      expect(items[0].kind).toBe(entry.order.buyType === 'solo' ? 'product' : 'group_buy');
    }
  });
});

describe('single-mode carts are unaffected', () => {
  it('still produces exactly one order for an on-hand-only cart', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 2, unit: 'piece' },
    ]));
    const body = await res.json();

    expect(body.data.orders).toHaveLength(1);
    expect(body.data.orders[0].order.buyType).toBe('solo');
    expect(body.data.orders[0].totals).toMatchObject({ subtotal: 1100, packingFee: 200, total: 1300 });
  });

  it('still produces exactly one order for a kahati-only cart', async () => {
    await signIn();
    const gb = await makeGroupBuy({ pricePerKitPhp: 9000, repackFeePhp: 150, minVials: 1 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }]));
    const body = await res.json();

    expect(body.data.orders).toHaveLength(1);
    expect(body.data.orders[0].order.buyType).toBe('kahati');
  });

  it('keeps the single-order response fields the checkout page already reads', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));
    const body = await res.json();

    // The client redirects to /success/{orderNo}; that contract must survive.
    expect(body.data.orderNo).toBe(body.data.orders[0].orderNo);
    expect(body.data.order.id).toBe(body.data.orders[0].order.id);
  });
});

describe('atomicity across the split', () => {
  it('creates no orders at all when one mode fails mid-checkout', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    // A closed hatian rejects, and must take the whole checkout down with it —
    // otherwise the customer is charged for a solo order they never confirmed.
    const gb = await makeGroupBuy({ status: 'closed', minVials: 1 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
      { kind: 'group_buy', refId: gb.id, qty: 1 },
    ]));

    expect(res.status).toBe(400);

    const { getDb, orders, products } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    expect(await db.select().from(orders)).toHaveLength(0);
    // Stock drawn for the on-hand line must be rolled back too.
    const [p] = await db.select().from(products).where(eq(products.id, product.id));
    expect(p.stock).toBe(50);
  });
});
