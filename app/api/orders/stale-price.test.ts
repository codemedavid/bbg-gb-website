// What happens when an admin changes a price while a customer holds a cart.
//
// The client asked this directly: "verify whether cart prices become stale if
// an admin changes a product price while a customer still has an old cart."
// They do. The cart persists in localStorage with unitPricePhp frozen at the
// moment Add was tapped, and there is nothing that ever revisits it.
//
// The server side of this was already right and stays right: POST /api/orders
// re-reads every price from the database and NEVER prices from the client's
// payload. So the customer was never overcharged by a tampered request — they
// were charged the correct current price. The problem is the other half: they
// were SHOWN the old one, agreed to it, uploaded a screenshot for it, and were
// then billed a different number with nothing said.
//
// The fix keeps the server as the only pricing authority and adds a second,
// separate job: compare what the cart quoted against what the database says,
// and refuse the checkout when they disagree. The quoted figure is evidence
// about what the customer saw. It is never arithmetic.
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
    ApiError,
    getSession: async () => session.current,
    requireSession,
    requireAdmin: async () => requireSession(),
  };
});

const { POST } = await import('./route');
const { getDb, products, orders } = await import('@/lib/db');
const { resetDb, makeUser, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const repriceTo = async (productId: string, piecePhp: number) => {
  const db = await getDb();
  await db.update(products)
    .set({ onHandPiecePhp: String(piecePhp) })
    .where(eq(products.id, productId));
};

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('a cart quoting a price the shop no longer charges', () => {
  it('refuses the checkout instead of silently billing the new price', async () => {
    await signIn();
    const product = await makeProduct({ isOnHand: true, stock: 50, onHandPiecePhp: 550 });
    // The admin raises the price while the cart sits open.
    await repriceTo(product.id, 700);

    const res = await POST(checkoutRequest(
      // …and the customer's cart still quotes what it showed them.
      [{ kind: 'product', refId: product.id, qty: 2, quotedUnitPricePhp: 550 }],
      { withProof: true },
    ));
    const body = await res.json();

    expect(res.status).toBe(409);
    // The message has to name both figures: "the price changed" without saying
    // to what leaves the customer unable to decide whether they still want it.
    expect(body.error).toMatch(/550/);
    expect(body.error).toMatch(/700/);
  });

  it('writes no order and draws no stock when it refuses', async () => {
    await signIn();
    const product = await makeProduct({ isOnHand: true, stock: 50, onHandPiecePhp: 550 });
    await repriceTo(product.id, 700);

    await POST(checkoutRequest(
      [{ kind: 'product', refId: product.id, qty: 2, quotedUnitPricePhp: 550 }],
      { withProof: true },
    ));

    const db = await getDb();
    expect(await db.select().from(orders)).toHaveLength(0);
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(50);
  });

  it('refuses a price that FELL as well as one that rose', async () => {
    // Not a favour to let this through. The customer agreed to a total, the
    // proof they uploaded is for that total, and an order that quietly costs
    // less than the screenshot is just as unreconcilable to whoever checks it.
    await signIn();
    const product = await makeProduct({ isOnHand: true, stock: 50, onHandPiecePhp: 550 });
    await repriceTo(product.id, 400);

    const res = await POST(checkoutRequest(
      [{ kind: 'product', refId: product.id, qty: 1, quotedUnitPricePhp: 550 }],
      { withProof: true },
    ));

    expect(res.status).toBe(409);
  });
});

describe('a cart quoting the price the shop actually charges', () => {
  it('checks out normally', async () => {
    await signIn();
    const product = await makeProduct({ isOnHand: true, stock: 50, onHandPiecePhp: 550 });

    const res = await POST(checkoutRequest(
      [{ kind: 'product', refId: product.id, qty: 2, quotedUnitPricePhp: 550 }],
      { withProof: true },
    ));

    expect(res.status).toBe(201);
  });

  it('still checks out when the cart quotes nothing at all', async () => {
    // Backwards compatibility, and it matters: a customer with an older bundle
    // cached sends no quote, and must not be locked out of the shop.
    await signIn();
    const product = await makeProduct({ isOnHand: true, stock: 50, onHandPiecePhp: 550 });

    const res = await POST(checkoutRequest(
      [{ kind: 'product', refId: product.id, qty: 2 }],
      { withProof: true },
    ));

    expect(res.status).toBe(201);
  });
});

describe('the quoted price is evidence, never arithmetic', () => {
  it('bills the database price, not the one the client sent', async () => {
    // The Part 4 invariant, restated against the new field so it cannot rot:
    // a hand-built request claiming a ₱1 vial is not a ₱1 vial. It is refused,
    // and what it must never do is produce a ₱1 order.
    await signIn();
    const product = await makeProduct({ isOnHand: true, stock: 50, onHandPiecePhp: 550 });

    const res = await POST(checkoutRequest(
      [{ kind: 'product', refId: product.id, qty: 2, quotedUnitPricePhp: 1 }],
      { withProof: true },
    ));

    expect(res.status).toBe(409);

    const db = await getDb();
    expect(await db.select().from(orders)).toHaveLength(0);
  });
});
