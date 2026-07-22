// Cancelling an order must release everything it was holding — not just MOQ
// stock. A kahati order holds claimed vials on its hatian counter, and an
// on-hand order holds drawn stock; a rejected payment proof (admin cancel) has
// to give both back, exactly as the expiry sweep does (lib/kahati-server.ts).
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
const { POST: placeOrder } = await import('@/app/api/orders/route');
const { getDb, groupBuys, products } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const cancelReq = () => new Request('http://localhost', {
  method: 'PATCH',
  body: JSON.stringify({ status: 'cancelled', note: 'proof rejected' }),
});

async function signIn(role: 'customer' | 'admin' = 'customer') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

async function checkout(items: unknown[]): Promise<string> {
  const res = await placeOrder(checkoutRequest(items));
  const body = await res.json();
  if (res.status !== 201) throw new Error(`checkout failed: ${body.error}`);
  return body.data.order.id as string;
}

async function claimedOf(id: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row.claimedSlots;
}

async function productRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('admin cancel releases kahati vials', () => {
  it('returns the claimed vials to an open hatian when the order is cancelled', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'group_buy', refId: gb.id, qty: 3 }]);
    expect(await claimedOf(gb.id)).toBe(3);

    await signIn('admin');
    const res = await PATCH(cancelReq(), ctx(orderId));

    expect(res.status).toBe(200);
    expect(await claimedOf(gb.id)).toBe(0);
  });

  it('does not release the same vials twice on a repeated cancel', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'group_buy', refId: gb.id, qty: 3 }]);
    await signIn('customer');
    await checkout([{ kind: 'group_buy', refId: gb.id, qty: 2 }]);
    expect(await claimedOf(gb.id)).toBe(5);

    await signIn('admin');
    await PATCH(cancelReq(), ctx(orderId));
    await PATCH(cancelReq(), ctx(orderId));

    // Only the first cancel releases; the second must not touch the counter.
    expect(await claimedOf(gb.id)).toBe(2);
  });

  it('leaves a terminal hatian’s historical count untouched', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'group_buy', refId: gb.id, qty: 3 }]);

    const db = await getDb();
    await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, gb.id));

    await signIn('admin');
    await PATCH(cancelReq(), ctx(orderId));

    // A closed hatian's count is a historical record of the ordered batch.
    expect(await claimedOf(gb.id)).toBe(3);
  });
});

describe('admin cancel restocks on-hand lines', () => {
  it('returns per-piece vials to stock and rolls back soldCount', async () => {
    const p = await makeProduct({ stock: 20 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'product', refId: p.id, qty: 3, unit: 'piece' }]);
    expect((await productRow(p.id)).stock).toBe(17);

    await signIn('admin');
    const res = await PATCH(cancelReq(), ctx(orderId));

    expect(res.status).toBe(200);
    const row = await productRow(p.id);
    expect(row.stock).toBe(20);
    expect(row.soldCount).toBe(0);
  });

  it('returns a whole kit’s worth of vials for a kit line', async () => {
    const p = await makeProduct({ stock: 20, onHandKitPhp: 5000 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'product', refId: p.id, qty: 1, unit: 'kit' }]);
    expect((await productRow(p.id)).stock).toBe(10);

    await signIn('admin');
    await PATCH(cancelReq(), ctx(orderId));

    expect((await productRow(p.id)).stock).toBe(20);
  });

  it('does not restock twice on a repeated cancel', async () => {
    const p = await makeProduct({ stock: 20 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'product', refId: p.id, qty: 3, unit: 'piece' }]);

    await signIn('admin');
    await PATCH(cancelReq(), ctx(orderId));
    await PATCH(cancelReq(), ctx(orderId));

    expect((await productRow(p.id)).stock).toBe(20);
  });
});
