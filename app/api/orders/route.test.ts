// Integration tests for the checkout route handler — the money path.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// requireSession() reads Next's request-scoped cookies, which do not exist under vitest.
// Swap it for a settable session; ApiError stays real so the handler maps errors normally.
const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const getSession = async () => session.current;
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError,
    getSession,
    requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST } = await import('./route');
const { getDb, groupBuys, orders, settings } = await import('@/lib/db');
const { resetDb, makeUser, makeProduct, makeGroupBuy, makePaymentMethod, checkoutRequest } = await import('@/lib/test/harness');

async function signIn(role: 'customer' | 'admin' = 'customer') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('POST /api/orders', () => {
  it('places a solo order and charges the on-hand packing fee once', async () => {
    await signIn();
    const product = await makeProduct({ pricePhp: 3200 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 2 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.totals).toMatchObject({ subtotal: 6400, packingFee: 200, total: 6600 });
  });

  it('rejects an order with no payment proof', async () => {
    await signIn();
    const product = await makeProduct();
    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1 }], { withProof: false }));
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const product = await makeProduct();
    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1 }]));
    expect(res.status).toBe(401);
  });

  it('enforces the group buy minVials at checkout', async () => {
    await signIn();
    const gb = await makeGroupBuy({ minVials: 20 });
    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 7 }]));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain('20');
  });

  it('persists the chosen payment method on the order', async () => {
    await signIn();
    const product = await makeProduct();
    await makePaymentMethod({ label: 'GCash' });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1 }], { paymentMethod: 'GCash' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.order.paymentMethod).toBe('GCash');
  });

  it('rejects a payment method that is not an active option', async () => {
    await signIn();
    const product = await makeProduct();
    await makePaymentMethod({ label: 'GCash', isActive: false });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1 }], { paymentMethod: 'GCash' }));
    expect(res.status).toBe(400);
  });

  it('charges the group buy packing fee (admin-editable per kahati)', async () => {
    await signIn();
    const gb = await makeGroupBuy({ repackFeePhp: 200, pricePerKitPhp: 9000 });
    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 7 }]));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.totals).toMatchObject({ packingFee: 200, total: 900 * 7 + 200 });
  });
});

describe('kahati downpayment at checkout', () => {
  it('snapshots the default ₱150 downpayment on a kahati order', async () => {
    await signIn();
    const gb = await makeGroupBuy({ pricePerKitPhp: 9000, repackFeePhp: 150 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 7 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.order.downpaymentPhp)).toBe(150);
    // The full total is unchanged — the downpayment is deducted from it, not added.
    expect(body.data.totals.total).toBe(900 * 7 + 150);
  });

  it('uses the admin-set downpayment when configured', async () => {
    await signIn();
    const db = await getDb();
    await db.insert(settings).values({ key: 'kahati_downpayment', value: '500' });
    const gb = await makeGroupBuy({ pricePerKitPhp: 9000 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 7 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.order.downpaymentPhp)).toBe(500);
  });

  it('caps the downpayment at the order total', async () => {
    await signIn();
    // 7 vials × ₱10 + ₱0 packing = ₱70 total, below the ₱150 default downpayment.
    const gb = await makeGroupBuy({ pricePerKitPhp: 100, repackFeePhp: 0 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 7 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.order.downpaymentPhp)).toBe(70);
  });

  it('records no downpayment on a solo order', async () => {
    await signIn();
    const product = await makeProduct({ pricePhp: 3200 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.order.downpaymentPhp)).toBe(0);
  });
});

describe('checkout concurrency', () => {
  it('gives concurrent orders distinct order numbers', async () => {
    await signIn();
    const product = await makeProduct({ stock: 100 });
    const item = [{ kind: 'product', refId: product.id, qty: 1 }];

    const results = await Promise.all([POST(checkoutRequest(item)), POST(checkoutRequest(item))]);

    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const db = await getDb();
    const rows = await db.select({ orderNo: orders.orderNo }).from(orders);
    expect(new Set(rows.map((r) => r.orderNo)).size).toBe(2);
  });

  it('never oversells kahati slots under concurrent commits', async () => {
    await signIn();
    // 10 slots, min 7: exactly one of two concurrent 7-vial commits can fit.
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 7 });
    const item = [{ kind: 'group_buy', refId: gb.id, qty: 7 }];

    const results = await Promise.all([POST(checkoutRequest(item)), POST(checkoutRequest(item))]);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(1);
    const db = await getDb();
    const [row] = await db.select({ claimed: groupBuys.claimedSlots }).from(groupBuys).where(eq(groupBuys.id, gb.id));
    expect(row.claimed).toBe(7);
  });
});
