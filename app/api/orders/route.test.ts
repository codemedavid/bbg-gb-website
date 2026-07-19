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
const { getDb, groupBuys, orders, products, settings } = await import('@/lib/db');
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
  it('prices an on-hand order per piece and charges the packing fee once', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 2, unit: 'piece' }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.totals).toMatchObject({ subtotal: 1100, packingFee: 200, total: 1300 });
  });

  it('prices a kit line at the on-hand kit price, not ten pieces', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, onHandKitPhp: 5000 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'kit' }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.totals).toMatchObject({ subtotal: 5000, total: 5200 });
  });

  it('ignores a client-sent price and re-prices from the catalog', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece', unitPricePhp: 1 },
    ]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.totals.subtotal).toBe(550);
  });

  it('defaults a line with no unit to a piece', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.totals.subtotal).toBe(550);
  });

  it('rejects a product that is not flagged on-hand', async () => {
    await signIn();
    const product = await makeProduct({ isOnHand: false });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }]));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('not available on-hand');
  });

  it('rejects a unit the product does not offer', async () => {
    await signIn();
    const product = await makeProduct({ onHandKitPhp: null });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'kit' }]));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('not sold by the kit');
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

  it('records no downpayment on an on-hand order', async () => {
    await signIn();
    const product = await makeProduct();

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.order.downpaymentPhp)).toBe(0);
  });
});

describe('on-hand stock', () => {
  const stockOf = async (id: string) => {
    const db = await getDb();
    const [row] = await db.select().from(products).where(eq(products.id, id));
    return { stock: row.stock, soldCount: row.soldCount };
  };

  it('draws one vial per piece from stock', async () => {
    await signIn();
    const product = await makeProduct({ stock: 20 });

    expect((await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 3, unit: 'piece' }]))).status).toBe(201);
    expect(await stockOf(product.id)).toMatchObject({ stock: 17, soldCount: 3 });
  });

  it('draws ten vials per kit from stock', async () => {
    await signIn();
    const product = await makeProduct({ stock: 20 });

    expect((await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'kit' }]))).status).toBe(201);
    expect(await stockOf(product.id)).toMatchObject({ stock: 10, soldCount: 10 });
  });

  it('rejects an order for more pieces than are in stock', async () => {
    await signIn();
    const product = await makeProduct({ stock: 2 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 3, unit: 'piece' }]));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('2');
    expect((await stockOf(product.id)).stock).toBe(2); // untouched
  });

  it('rejects a kit when fewer than ten vials remain', async () => {
    await signIn();
    const product = await makeProduct({ stock: 9 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'kit' }]));
    expect(res.status).toBe(400);
    expect((await stockOf(product.id)).stock).toBe(9);
  });

  it('rejects any purchase once stock is exhausted', async () => {
    await signIn();
    const product = await makeProduct({ stock: 0 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }]));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Out of stock');
  });

  it('never oversells stock under concurrent checkouts', async () => {
    await signIn();
    // 1 vial left, two racing buyers: exactly one may win.
    const product = await makeProduct({ stock: 1 });
    const item = [{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }];

    const results = await Promise.all([POST(checkoutRequest(item)), POST(checkoutRequest(item))]);
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([201, 400]);
    expect((await stockOf(product.id)).stock).toBe(0);
  });

  it('leaves stock untouched when a later line in the same order fails', async () => {
    await signIn();
    const good = await makeProduct({ stock: 10, name: 'Good' });
    const short = await makeProduct({ stock: 1, name: 'Short' });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: good.id, qty: 1, unit: 'piece' },
      { kind: 'product', refId: short.id, qty: 5, unit: 'piece' },
    ]));

    expect(res.status).toBe(400);
    // The whole checkout is one transaction — the good line must roll back too.
    expect((await stockOf(good.id)).stock).toBe(10);
    expect((await stockOf(short.id)).stock).toBe(1);
  });
});

describe('hatian auto-open on fill', () => {
  it('does not close or clone a hatian that is still under the cap', async () => {
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1, claimedSlots: 0 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 6 }]));
    expect(res.status).toBe(201);

    const db = await getDb();
    const rows = await db.select().from(groupBuys);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'open', claimedSlots: 6 });
  });

  it('closes a hatian at the 10-vial cap and auto-opens a fresh sibling', async () => {
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1, claimedSlots: 0, pricePerKitPhp: 9000, name: 'Reta 20mg' });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 10 }]));
    expect(res.status).toBe(201);

    const db = await getDb();
    const [filled] = await db.select().from(groupBuys).where(eq(groupBuys.id, gb.id));
    expect(filled).toMatchObject({ status: 'closed', claimedSlots: 10 });

    const siblings = (await db.select().from(groupBuys)).filter((g) => g.id !== gb.id);
    expect(siblings).toHaveLength(1);
    // The sibling inherits the product, price, cap and min, and starts empty & open.
    expect(siblings[0]).toMatchObject({
      name: 'Reta 20mg', pricePerKitPhp: '9000.00', totalSlots: 10,
      minVials: 1, claimedSlots: 0, status: 'open',
    });
  });

  it('fills across two commits, then closes and clones on the one that reaches the cap', async () => {
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1, claimedSlots: 0 });

    expect((await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 6 }]))).status).toBe(201);
    const db = await getDb();
    expect(await db.select().from(groupBuys)).toHaveLength(1); // no clone yet

    expect((await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 4 }]))).status).toBe(201);
    const rows = await db.select().from(groupBuys);
    expect(rows).toHaveLength(2);
    expect(rows.filter((g) => g.status === 'closed')).toHaveLength(1);
    expect(rows.filter((g) => g.status === 'open' && g.claimedSlots === 0)).toHaveLength(1);
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
