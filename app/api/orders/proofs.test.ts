// Multiple proofs of payment, one order.
//
// Banks cap a single transfer, so a ₱4,500 order is often paid in two or three.
// The customer ends up holding three screenshots for one order — and the point
// of the whole change is that those three attach to that ONE order rather than
// becoming three orders, which is what §13 spells out at length.
//
// The cap of five is checked on this route, not only in the file input: the
// count arrives in a multipart body anyone can hand-build.
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

const { POST: placeOrder } = await import('./route');
const { resetDb, makeUser, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

/** Every order row in the database, and every proof attached to any of them. */
async function stored() {
  const { getDb, orders, orderPaymentProofs } = await import('@/lib/db');
  const { asc } = await import('drizzle-orm');
  const db = await getDb();
  return {
    orders: await db.select().from(orders),
    proofs: await db.select().from(orderPaymentProofs).orderBy(asc(orderPaymentProofs.sortOrder)),
  };
}

const buy = async (product: { id: string }, proofCount: number) =>
  placeOrder(checkoutRequest(
    [{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }],
    { proofCount },
  ));

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('POST /api/orders — one proof', () => {
  it('creates one order carrying one proof', async () => {
    await signIn();
    const product = await makeProduct();

    const res = await buy(product, 1);
    const { orders, proofs } = await stored();

    expect(res.status).toBe(201);
    expect(orders).toHaveLength(1);
    expect(proofs).toHaveLength(1);
  });

  it('attaches the proof to the order that was placed', async () => {
    await signIn();
    const product = await makeProduct();

    await buy(product, 1);
    const { orders, proofs } = await stored();

    expect(proofs[0].orderId).toBe(orders[0].id);
  });
});

describe('POST /api/orders — three proofs', () => {
  it('creates ONE order, not one per proof', async () => {
    // §13, stated as plainly as the requirement does: three transfers against
    // one ₱4,500 total is one order with three proofs.
    await signIn();
    const product = await makeProduct();

    const res = await buy(product, 3);
    const { orders, proofs } = await stored();

    expect(res.status).toBe(201);
    expect(orders).toHaveLength(1);
    expect(proofs).toHaveLength(3);
  });

  it('attaches all three to that same order', async () => {
    await signIn();
    const product = await makeProduct();

    await buy(product, 3);
    const { orders, proofs } = await stored();

    expect(new Set(proofs.map((p) => p.orderId))).toEqual(new Set([orders[0].id]));
  });

  it('numbers them in the order they were submitted', async () => {
    // "Proof #2" has to mean the same file to the customer who uploaded it and
    // the admin who checks it against the bank statement.
    await signIn();
    const product = await makeProduct();

    await buy(product, 3);
    const { proofs } = await stored();

    expect(proofs.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it('stores three distinct files rather than three rows pointing at one', async () => {
    await signIn();
    const product = await makeProduct();

    await buy(product, 3);
    const { proofs } = await stored();

    expect(new Set(proofs.map((p) => p.storageKey)).size).toBe(3);
  });
});

describe('POST /api/orders — five proofs', () => {
  it('accepts the full five on one order', async () => {
    await signIn();
    const product = await makeProduct();

    const res = await buy(product, 5);
    const { orders, proofs } = await stored();

    expect(res.status).toBe(201);
    expect(orders).toHaveLength(1);
    expect(proofs).toHaveLength(5);
  });
});

describe('POST /api/orders — six proofs', () => {
  it('refuses the submission', async () => {
    await signIn();
    const product = await makeProduct();

    const res = await buy(product, 6);

    expect(res.status).toBe(400);
  });

  it('names the limit so the customer knows what to remove', async () => {
    await signIn();
    const product = await makeProduct();

    const body = await (await buy(product, 6)).json();

    expect(body.error).toMatch(/5/);
  });

  it('creates no order and no proof rows', async () => {
    await signIn();
    const product = await makeProduct();

    await buy(product, 6);
    const { orders, proofs } = await stored();

    expect(orders).toEqual([]);
    expect(proofs).toEqual([]);
  });

  it('draws down no stock', async () => {
    await signIn();
    const product = await makeProduct({ stock: 100 });

    await buy(product, 6);

    const { getDb, products } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await (await getDb()).select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(100);
  });
});

describe('POST /api/orders — no proof', () => {
  it('still refuses an order with nothing attached', async () => {
    await signIn();
    const product = await makeProduct();

    const res = await placeOrder(checkoutRequest(
      [{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }],
      { withProof: false },
    ));

    expect(res.status).toBe(400);
  });
});

describe('the legacy single-proof column', () => {
  it('still carries the first proof, so every existing reader keeps working', async () => {
    // orders.payment_proof_key is read by the admin drawer, the customer's own
    // order page, the commitments export and the reports. Keeping it filled is
    // what makes this change additive rather than a five-site rewrite.
    await signIn();
    const product = await makeProduct();

    await buy(product, 3);
    const { orders, proofs } = await stored();

    expect(orders[0].paymentProofKey).toBe(proofs[0].storageKey);
  });
});

describe('a cart that splits into several orders', () => {
  it('gives every order created by the checkout the same proofs', async () => {
    // A mixed cart becomes one order per purchasing mode — pre-existing
    // behaviour. The customer paid one total and uploaded proof of it, so each
    // resulting order has to carry that evidence; an order with none would look
    // unpaid to the admin reviewing it.
    await signIn();
    const product = await makeProduct();
    const moqProduct = await (await import('@/lib/test/harness')).makeMoqProduct();

    const res = await placeOrder(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
      { kind: 'moq_product', refId: moqProduct.id, qty: 1 },
    ], { proofCount: 2 }));
    const { orders, proofs } = await stored();

    expect(res.status).toBe(201);
    expect(orders).toHaveLength(2);
    expect(proofs).toHaveLength(4);
    for (const order of orders) {
      expect(proofs.filter((p) => p.orderId === order.id)).toHaveLength(2);
    }
  });
});
