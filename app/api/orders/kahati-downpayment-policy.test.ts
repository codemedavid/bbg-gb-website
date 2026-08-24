// A hatian commitment collects the CONFIGURED downpayment, not the whole order.
//
// The refund problem this closes: a kit only gets ordered once it reaches
// KAHATI_MIN_VIABLE_VIALS, and under that every peso collected has to go back.
// Charging a bounded deposit instead of the full price is what keeps a
// cancelled kit from becoming a full-price refund.
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
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST } = await import('./route');
const { setKahatiDownpaymentPolicy } = await import('@/lib/settings');
const { resetDb, openBoards, makeUser, makeGroupBuy, makeProduct, checkoutRequest } =
  await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const join = async (kahatiId: string, qty = 2, opts = {}) => {
  const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: kahatiId, qty }], opts));
  const body = await res.json();
  return { status: res.status, body };
};

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('kahati downpayment under a fixed policy', () => {
  it('collects the configured flat deposit instead of the packing fee', async () => {
    // Arrange
    await signIn();
    await setKahatiDownpaymentPolicy({
      mode: 'fixed', amountPhp: 500, percent: 0, refundable: true, policyNote: null,
    });
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });

    // Act — 2 vials at ₱900/vial = ₱1,800 + ₱150 fee.
    const { status, body } = await join(kahati.id, 2);

    // Assert
    expect(status).toBe(201);
    expect(Number(body.data.order.downpaymentPhp)).toBe(500);
    // The order total is untouched: the deposit is deducted from what is left
    // to collect, never taken out of what the goods cost.
    expect(Number(body.data.order.totalPhp)).toBe(1950);
  });

  it('leaves the rest as the balance to settle once the kit is complete', async () => {
    await signIn();
    await setKahatiDownpaymentPolicy({
      mode: 'fixed', amountPhp: 500, percent: 0, refundable: true, policyNote: null,
    });
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });

    const { body } = await join(kahati.id, 2);
    const order = body.data.order;

    expect(Number(order.totalPhp) - Number(order.downpaymentPhp)).toBe(1450);
  });

  it('asks for a deposit on the SECOND kit too — a deposit secures a kit, not a week', async () => {
    // The packing fee is waived once a cycle because one cycle is one parcel.
    // A deposit is not a parcel charge: the second kit is unsecured without one.
    await signIn();
    await setKahatiDownpaymentPolicy({
      mode: 'fixed', amountPhp: 500, percent: 0, refundable: true, policyNote: null,
    });
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await join(kahati.id, 2);

    const { body } = await join(kahati.id, 3);

    expect(Number(body.data.order.downpaymentPhp)).toBe(500);
    // And because money is due, the order is a real proof review — not the
    // confirm-only path that exists for commitments owing nothing.
    expect(body.data.order.status).toBe('proof_review');
  });

  it('never collects more than the order is worth', async () => {
    await signIn();
    await setKahatiDownpaymentPolicy({
      mode: 'fixed', amountPhp: 5000, percent: 0, refundable: true, policyNote: null,
    });
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 1000, repackFeePhp: 150 });

    // 1 vial at ₱100 + ₱150 fee = ₱250 — well under the ₱5,000 deposit.
    const { body } = await join(kahati.id, 1);

    expect(Number(body.data.order.downpaymentPhp)).toBe(250);
    expect(Number(body.data.order.totalPhp)).toBe(250);
  });
});

describe('kahati downpayment under a percentage policy', () => {
  it('collects the configured share of the order total', async () => {
    await signIn();
    await setKahatiDownpaymentPolicy({
      mode: 'percent', amountPhp: 0, percent: 20, refundable: true, policyNote: null,
    });
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });

    const { body } = await join(kahati.id, 2);

    // 20% of (1800 + 150)
    expect(Number(body.data.order.downpaymentPhp)).toBe(390);
  });
});

describe('kahati downpayment under the default policy', () => {
  it('still collects only the packing fee, exactly as before', async () => {
    // The installed behaviour must not change for anyone who has not configured
    // a downpayment.
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });

    const { body } = await join(kahati.id, 2);

    expect(Number(body.data.order.downpaymentPhp)).toBe(150);
  });

  it('still waives the second commitment in the same cycle', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });
    await join(kahati.id, 2);

    const { body } = await join(kahati.id, 3, { withProof: false });

    expect(Number(body.data.order.downpaymentPhp)).toBe(0);
    expect(body.data.order.status).toBe('payment_confirmed');
  });
});

describe('a deposit policy does not touch the other purchase modes', () => {
  it('leaves an on-hand order paying in full', async () => {
    await signIn();
    await setKahatiDownpaymentPolicy({
      mode: 'fixed', amountPhp: 500, percent: 0, refundable: true, policyNote: null,
    });
    const product = await makeProduct({ isOnHand: true, stock: 10, onHandPiecePhp: 1000 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.order.downpaymentPhp)).toBe(0);
  });
});
