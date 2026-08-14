// Admin visibility into one hatian: who committed, how many vials, when, and
// where each of their three payments stands.
//
// Without this the admin cannot tell a customer who has paid everything from one
// who is still sitting on an unpaid balance and packing fee — which is the whole
// point of deferring the fee to a final checkout.
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
  const requireAdmin = async () => {
    const s = await requireSession();
    if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
    return s;
  };
  return { ApiError, getSession: async () => session.current, requireSession, requireAdmin };
});

const { GET } = await import('./[id]/commitments/route');
const { POST: SETTLE } = await import('../../settlements/route');
const { POST: CHECKOUT } = await import('../../orders/route');
const { resetDb, openBoards, makeUser, makeGroupBuy, checkoutRequest, settlementRequest } = await import('@/lib/test/harness');
const { getDb, groupBuys, orders, settlements } = await import('@/lib/db');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request('http://localhost/api/admin/groupbuys/x/commitments');

async function asCustomer(email: string) {
  const user = await makeUser({ role: 'customer', email });
  session.current = { sub: user.id, role: 'customer', email: user.email };
  return user;
}
async function asAdmin() {
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('GET /api/admin/groupbuys/[id]/commitments', () => {
  it('lists each customer, their vials and when they committed', async () => {
    const gb = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150, totalSlots: 100 });
    await asCustomer('ana@example.com');
    await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 3 }]));
    await asCustomer('ben@example.com');
    await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }]));
    await asAdmin();

    const body = await (await GET(req(), ctx(gb.id))).json();

    expect(body.data).toHaveLength(2);
    const byEmail = Object.fromEntries(body.data.map((r: { customerEmail: string }) => [r.customerEmail, r]));
    expect(byEmail['ana@example.com'].vials).toBe(3);
    expect(byEmail['ben@example.com'].vials).toBe(2);
    expect(byEmail['ana@example.com'].committedAt).toBeTruthy();
    // A hatian commitment is a Kahati order, so it carries the Kahati
    // reference. This used to read BBG-, back when every system shared one
    // series and an admin could not tell a hatian order from a group buy one
    // without opening it (see lib/order-number.ts).
    expect(byEmail['ana@example.com'].orderNo).toMatch(/^KH-/);
  });

  it('reports the downpayment as under review until the proof is confirmed', async () => {
    const gb = await makeGroupBuy({ minVials: 1 });
    await asCustomer('ana@example.com');
    await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 3 }]));
    await asAdmin();

    const [row] = (await (await GET(req(), ctx(gb.id))).json()).data;
    expect(row.downpayment).toBe('under_review');

    const db = await getDb();
    await db.update(orders).set({ status: 'payment_confirmed' });
    const [confirmed] = (await (await GET(req(), ctx(gb.id))).json()).data;
    expect(confirmed.downpayment).toBe('paid');
  });

  it('flags an unpaid final payment, with the packing fee already settled', async () => {
    // The packing fee is collected at checkout with the cycle it belongs to, so
    // it reads as paid from the moment the commitment is made. Only the goods
    // are still outstanding.
    const gb = await makeGroupBuy({ minVials: 1 });
    await asCustomer('ana@example.com');
    await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 3 }]));
    await asAdmin();

    const [row] = (await (await GET(req(), ctx(gb.id))).json()).data;
    expect(row.finalPayment).toBe('unpaid');
    expect(row.packingFee).toBe('paid');
    // ₱2,700 of goods, whole: the ₱150 fee was added to the order and paid, so
    // it was never taken out of what the vials cost.
    expect(row.orderBalancePhp).toBe(2700);
  });

  it('keeps the packing fee paid while the balance settles', async () => {
    const gb = await makeGroupBuy({ minVials: 1, repackFeePhp: 150 });
    await asCustomer('ana@example.com');
    await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 3 }]));

    const db = await getDb();
    await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, gb.id));
    await SETTLE(settlementRequest());

    await asAdmin();
    // The fee was paid at checkout; only the balance is under review.
    const [underReview] = (await (await GET(req(), ctx(gb.id))).json()).data;
    expect(underReview.packingFee).toBe('paid');
    expect(underReview.finalPayment).toBe('under_review');

    await db.update(settlements).set({ status: 'paid', paidAt: new Date() });
    const [paid] = (await (await GET(req(), ctx(gb.id))).json()).data;
    expect(paid.packingFee).toBe('paid');
    expect(paid.finalPayment).toBe('paid');
  });

  it('does not report the same balance under two counters when a commitment overflows', async () => {
    // A commitment larger than the counter's remaining vials rolls into a fresh
    // sibling, giving ONE order lines against two hatians. Reporting the whole
    // order balance under each would make an admin totalling "what this hatian is
    // owed" count the same money twice.
    const gb = await makeGroupBuy({ minVials: 1, totalSlots: 10, claimedSlots: 8, pricePerKitPhp: 9000 });
    await asCustomer('ana@example.com');
    await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 5 }])); // 2 here, 3 in the sibling
    await asAdmin();

    const db = await getDb();
    const sibling = (await db.select().from(groupBuys)).find((g) => g.id !== gb.id)!;

    const [onOriginal] = (await (await GET(req(), ctx(gb.id))).json()).data;
    const [onSibling] = (await (await GET(req(), ctx(sibling.id))).json()).data;

    // Vials are already split per counter; the balance must be labelled as the
    // whole order's and flagged as spanning counters, so it is never summed blind.
    expect(onOriginal.vials).toBe(2);
    expect(onSibling.vials).toBe(3);
    expect(onOriginal.spansOtherHatians).toBe(true);
    expect(onSibling.spansOtherHatians).toBe(true);
    expect(onOriginal.orderBalancePhp).toBe(onSibling.orderBalancePhp);
  });

  it('does not flag a single-counter commitment as spanning', async () => {
    const gb = await makeGroupBuy({ minVials: 1, totalSlots: 100 });
    await asCustomer('ana@example.com');
    await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 3 }]));
    await asAdmin();

    const [row] = (await (await GET(req(), ctx(gb.id))).json()).data;
    expect(row.spansOtherHatians).toBe(false);
  });

  it('refuses a customer', async () => {
    const gb = await makeGroupBuy({ minVials: 1 });
    await asCustomer('ana@example.com');
    const res = await GET(req(), ctx(gb.id));
    expect(res.status).toBe(403);
  });
});
