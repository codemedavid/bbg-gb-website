// Cancelling an MOQ order must release its commitment.
//
// An MOQ order commits units towards the shelf's target inside the checkout
// transaction. Cancelling it has to take them back off, or the target reads as
// closer than it is — a buy that never had the demand goes to the supplier on
// the strength of orders that were refunded. Nothing errors; the number is just
// wrong, in the direction that costs money.
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

const { PATCH } = await import('./route');
const { POST: CHECKOUT } = await import('@/app/api/orders/route');
const { getDb, moqProducts } = await import('@/lib/db');
const { resetDb, makeUser, makeMoqProduct, checkoutRequest } = await import('@/lib/test/harness');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const statusReq = (status: string) =>
  new Request('http://localhost', {
    method: 'PATCH',
    body: JSON.stringify({ status }),
    headers: { 'content-type': 'application/json' },
  });

async function buyAsCustomer(productId: string, qty: number): Promise<string> {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: 'customer', email: user.email };
  const res = await CHECKOUT(checkoutRequest([{ kind: 'moq_product', refId: productId, qty }]));
  const body = await res.json();
  return body.data.order.id as string;
}

const asAdmin = async () => {
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
};

async function committedOf(id: string): Promise<number> {
  const [row] = await (await getDb()).select().from(moqProducts).where(eq(moqProducts.id, id));
  return row.committed;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('cancelling an MOQ order releases its commitment', () => {
  it('takes the cancelled units back off the counter', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const orderId = await buyAsCustomer(p.id, 8);
    expect(await committedOf(p.id)).toBe(8);

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await committedOf(p.id)).toBe(0);
  });

  it('does not release twice when an order is cancelled twice', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 100 });
    const orderId = await buyAsCustomer(p.id, 8);

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await committedOf(p.id)).toBe(100);
  });

  // A counter can never go below zero, whatever an admin does to an old order.
  it('never drives the counter negative', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const orderId = await buyAsCustomer(p.id, 8);

    const db = await getDb();
    await db.update(moqProducts).set({ committed: 3 }).where(eq(moqProducts.id, p.id));

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await committedOf(p.id)).toBe(0);
  });

  it('leaves the counter alone for a status change that is not a cancellation', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const orderId = await buyAsCustomer(p.id, 8);

    await asAdmin();
    await PATCH(statusReq('payment_confirmed'), ctx(orderId));

    expect(await committedOf(p.id)).toBe(8);
  });

  it('releases every MOQ line on a multi-product order', async () => {
    const a = await makeMoqProduct({ name: 'A', moq: 300, committed: 0 });
    const b = await makeMoqProduct({ name: 'B', moq: 200, committed: 0 });

    const user = await makeUser({ role: 'customer' });
    session.current = { sub: user.id, role: 'customer', email: user.email };
    const res = await CHECKOUT(checkoutRequest([
      { kind: 'moq_product', refId: a.id, qty: 5 },
      { kind: 'moq_product', refId: b.id, qty: 3 },
    ]));
    const orderId = (await res.json()).data.order.id as string;
    expect(await committedOf(a.id)).toBe(5);
    expect(await committedOf(b.id)).toBe(3);

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await committedOf(a.id)).toBe(0);
    expect(await committedOf(b.id)).toBe(0);
  });

  // The release must debit the round the order actually joined. Once a round is
  // closed the units it held were ordered from the supplier; cancelling one of
  // those orders afterwards is a refund against a buy that already went out, and
  // taking the units off the CURRENT counter would erase demand that belongs to
  // the people now filling round 2 — stalling a buy that was ready to place.
  it('leaves the current round alone when cancelling an order from a closed one', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const orderId = await buyAsCustomer(p.id, 200);

    const db = await getDb();
    // The admin closed round 1 and round 2 has been filling since.
    await db.update(moqProducts).set({ cycleNo: 2, committed: 300 }).where(eq(moqProducts.id, p.id));

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await committedOf(p.id)).toBe(300);
  });

  it('releases an archived product too — the commitment was still real', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const orderId = await buyAsCustomer(p.id, 8);

    const db = await getDb();
    await db.update(moqProducts).set({ isActive: false }).where(eq(moqProducts.id, p.id));

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await committedOf(p.id)).toBe(0);
  });
});
