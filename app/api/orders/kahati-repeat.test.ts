// A customer who already holds a live kahati commitment is not asked to pay
// again. The downpayment reserves their place in the next parcel; while that
// place is held (a hatian they joined is still open), a further kahati
// commitment is confirm-only — no downpayment, no proof, nothing to review.
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
const { getDb, groupBuys, orders } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

// Places a first kahati commitment the normal way — with a proof and a
// downpayment — so the follow-up commitment has something to be a repeat of.
async function joinFirstKahati(kahatiId: string, qty = 2) {
  const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: kahatiId, qty }]));
  expect(res.status).toBe(201);
  return res.json();
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('repeat kahati checkout', () => {
  it('charges the downpayment on the first commitment', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });

    const body = await joinFirstKahati(kahati.id);

    expect(Number(body.data.order.downpaymentPhp)).toBe(150);
    expect(body.data.order.status).toBe('proof_review');
  });

  it('charges no downpayment on a second commitment while the first hatian is open', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await joinFirstKahati(kahati.id);

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 3 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.order.downpaymentPhp)).toBe(0);
  });

  it('accepts a second commitment with no payment proof at all', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await joinFirstKahati(kahati.id);

    const res = await POST(checkoutRequest(
      [{ kind: 'group_buy', refId: kahati.id, qty: 3 }],
      { withProof: false },
    ));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.order.paymentProofKey).toBeNull();
  });

  it('confirms a no-payment commitment instead of parking it in proof review', async () => {
    // Nothing was paid, so there is no proof for an admin to verify. Leaving it
    // at 'proof_review' would queue a review that can never resolve.
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await joinFirstKahati(kahati.id);

    const res = await POST(checkoutRequest(
      [{ kind: 'group_buy', refId: kahati.id, qty: 3 }],
      { withProof: false },
    ));
    const body = await res.json();

    expect(body.data.order.status).toBe('payment_confirmed');
  });

  it('still claims the vials on a confirm-only commitment', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await joinFirstKahati(kahati.id, 2);

    await POST(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 3 }], { withProof: false }));

    const db = await getDb();
    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, kahati.id));
    expect(row.claimedSlots).toBe(5);
  });

  it('waives the downpayment across hatians — any open commitment counts', async () => {
    await signIn();
    const joined = await makeGroupBuy({ name: 'Reta 20mg', minVials: 1, pricePerKitPhp: 9000 });
    const other = await makeGroupBuy({ name: 'Tirze 30mg', minVials: 1, pricePerKitPhp: 12000 });
    await joinFirstKahati(joined.id);

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: other.id, qty: 2 }], { withProof: false }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.order.downpaymentPhp)).toBe(0);
  });

  it('asks for a downpayment again once every hatian they joined has sealed', async () => {
    await signIn();
    const sealed = await makeGroupBuy({ name: 'Reta 20mg', minVials: 1, pricePerKitPhp: 9000 });
    await joinFirstKahati(sealed.id);
    const db = await getDb();
    await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, sealed.id));

    const fresh = await makeGroupBuy({ name: 'Sema 10mg', minVials: 1, pricePerKitPhp: 9000 });
    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: fresh.id, qty: 2 }]));
    const body = await res.json();

    expect(Number(body.data.order.downpaymentPhp)).toBe(150);
  });

  it('does not count a cancelled order as a live commitment', async () => {
    // A cancelled hatian refunds the downpayment, so the customer is no longer
    // holding a place — the next join pays its own.
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    const first = await joinFirstKahati(kahati.id);
    const db = await getDb();
    await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, first.data.order.id));

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 2 }]));
    const body = await res.json();

    expect(Number(body.data.order.downpaymentPhp)).toBe(150);
  });

  it('still requires proof when the cart also holds an on-hand item', async () => {
    // The waiver covers the kahati downpayment only. On-hand stock is paid for
    // at checkout, so that cart owes money and must carry a proof.
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await joinFirstKahati(kahati.id);
    const product = await makeProduct({ onHandPiecePhp: 550 });

    const res = await POST(checkoutRequest([
      { kind: 'group_buy', refId: kahati.id, qty: 2 },
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ], { withProof: false }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/proof/i);
  });

  it('still rejects a first commitment that carries no proof', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 2 }], { withProof: false }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/proof/i);
  });
});
