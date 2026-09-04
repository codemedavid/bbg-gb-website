// What checkout is allowed to say about money.
//
// The reported bug: "customers complete checkout and the system immediately
// shows Payment Confirmed even though the customer has NOT uploaded any payment
// proof." It is real, and it is in the database rather than in a label — at the
// time of writing, 24 live orders sit at status='payment_confirmed' carrying no
// proof row and no proof key, ₱43,500 of goods between them, placed between
// 2026-08-08 and the day this was written.
//
// The cause is that a repeat kahati commitment genuinely owes ₱0 at checkout
// (the cycle's packing fee is already paid), the single status column had no
// word for that, and 'payment_confirmed' was the nearest one. These tests pin
// the distinction the client asked for: ORDER CREATED, PAYMENT PENDING, PROOF
// SUBMITTED and PAYMENT VERIFIED are four different things, and only an admin
// may produce the fourth.
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
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST } = await import('./route');
const { getDb, orders } = await import('@/lib/db');
const { isPaymentVerified } = await import('@/lib/payment-status');
const {
  resetDb, openBoards, makeUser, makeGroupBuy, makeProduct, checkoutRequest,
} = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const storedOrder = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row;
};

/** A first kahati commitment, paid and evidenced, so a repeat can follow it. */
async function joinFirstKahati(kahatiId: string, qty = 2) {
  const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: kahatiId, qty }]));
  expect(res.status).toBe(201);
  return res.json();
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('a checkout that owes nothing today', () => {
  it('records that no payment was due, not that one was confirmed', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await joinFirstKahati(kahati.id);

    const res = await POST(checkoutRequest(
      [{ kind: 'group_buy', refId: kahati.id, qty: 3 }],
      { withProof: false },
    ));
    const body = await res.json();
    const row = await storedOrder(body.data.order.id);

    expect(res.status).toBe(201);
    expect(row.paymentStatus).toBe('not_due');
    // The regression itself: nothing in the row may claim a verified payment.
    expect(isPaymentVerified(row.paymentStatus)).toBe(false);
  });

  it('still owes the goods, so the order total is untouched', async () => {
    // "Nothing due now" must not be mistaken for "nothing to pay, ever" — the
    // vials are settled when the kit completes.
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await joinFirstKahati(kahati.id);

    const res = await POST(checkoutRequest(
      [{ kind: 'group_buy', refId: kahati.id, qty: 3 }],
      { withProof: false },
    ));
    const body = await res.json();

    expect(Number(body.data.order.totalPhp)).toBeGreaterThan(0);
  });
});

describe('a checkout that was paid for', () => {
  it('records an attached proof as submitted, awaiting an admin', async () => {
    await signIn();
    const product = await makeProduct({ isOnHand: true, stock: 10, onHandPiecePhp: 550 });

    const res = await POST(checkoutRequest(
      [{ kind: 'product', refId: product.id, qty: 1 }],
      { withProof: true },
    ));
    const body = await res.json();
    const row = await storedOrder(body.data.order.id);

    expect(row.paymentStatus).toBe('proof_submitted');
    expect(isPaymentVerified(row.paymentStatus)).toBe(false);
  });
});

describe('no checkout, however it is shaped, may verify its own payment', () => {
  it('leaves every order this route creates unverified', async () => {
    // A mixed cart, the most complex shape checkout produces: several orders
    // from one submission, spanning modes with different payment rules. Not one
    // of them may come out claiming an admin looked at it.
    await signIn();
    const product = await makeProduct({ isOnHand: true, stock: 50, onHandPiecePhp: 550 });
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });

    const res = await POST(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 2 },
      { kind: 'group_buy', refId: kahati.id, qty: 2 },
    ]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.orders.length).toBeGreaterThan(1);
    for (const created of body.data.orders) {
      const row = await storedOrder(created.order.id);
      expect(isPaymentVerified(row.paymentStatus)).toBe(false);
    }
  });
});
