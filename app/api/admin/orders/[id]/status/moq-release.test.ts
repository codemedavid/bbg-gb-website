// Cancelling an MOQ order must return its units to the shelf.
//
// MOQ products hold finite stock, drawn down inside the checkout transaction.
// The cancellation path already releases group-buy campaign commitments, but it
// was never taught about MOQ lines — so an admin cancelling an MOQ order left
// the units deducted forever. Nothing errors; the stock is simply gone, and the
// shelf under-sells from then on.
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

async function stockOf(id: string): Promise<number> {
  const [row] = await (await getDb()).select().from(moqProducts).where(eq(moqProducts.id, id));
  return row.stock;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('cancelling an MOQ order restocks the shelf', () => {
  it('returns the purchased units to stock', async () => {
    const p = await makeMoqProduct({ stock: 50, minOrderQty: 1 });
    const orderId = await buyAsCustomer(p.id, 8);
    expect(await stockOf(p.id)).toBe(42);

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await stockOf(p.id)).toBe(50);
  });

  it('does not double-restock when an order is cancelled twice', async () => {
    const p = await makeMoqProduct({ stock: 50, minOrderQty: 1 });
    const orderId = await buyAsCustomer(p.id, 8);

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await stockOf(p.id)).toBe(50);
  });

  it('leaves stock alone for a status change that is not a cancellation', async () => {
    const p = await makeMoqProduct({ stock: 50, minOrderQty: 1 });
    const orderId = await buyAsCustomer(p.id, 8);

    await asAdmin();
    await PATCH(statusReq('payment_confirmed'), ctx(orderId));

    expect(await stockOf(p.id)).toBe(42);
  });

  it('restocks every MOQ line on a multi-product order', async () => {
    const a = await makeMoqProduct({ name: 'A', stock: 30, minOrderQty: 1 });
    const b = await makeMoqProduct({ name: 'B', stock: 20, minOrderQty: 1 });

    const user = await makeUser({ role: 'customer' });
    session.current = { sub: user.id, role: 'customer', email: user.email };
    const res = await CHECKOUT(checkoutRequest([
      { kind: 'moq_product', refId: a.id, qty: 5 },
      { kind: 'moq_product', refId: b.id, qty: 3 },
    ]));
    const orderId = (await res.json()).data.order.id as string;
    expect(await stockOf(a.id)).toBe(25);
    expect(await stockOf(b.id)).toBe(17);

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await stockOf(a.id)).toBe(30);
    expect(await stockOf(b.id)).toBe(20);
  });

  it('restocks an archived product too — the units still exist', async () => {
    const p = await makeMoqProduct({ stock: 50, minOrderQty: 1 });
    const orderId = await buyAsCustomer(p.id, 8);

    const db = await getDb();
    await db.update(moqProducts).set({ isActive: false }).where(eq(moqProducts.id, p.id));

    await asAdmin();
    await PATCH(statusReq('cancelled'), ctx(orderId));

    expect(await stockOf(p.id)).toBe(50);
  });
});
