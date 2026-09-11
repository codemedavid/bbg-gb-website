// Two admins cancelling the same order at the same moment must release what it
// holds exactly once.
//
// The single-request case is covered by kahati-cancel-release.test.ts, and it
// passes because the "did this order just become cancelled" guard compares the
// order's status before the write. That comparison reads a snapshot taken
// OUTSIDE the transaction, so two overlapping requests both read 'pending',
// both decide they are the transition into 'cancelled', and both release —
// taking twice the vials off a live counter. Nothing errors; the counter is
// just wrong, and wrong in the direction that sends a batch to the supplier
// short.
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
const { getDb, groupBuys, products, moqProducts } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeGroupBuy, makeProduct, makeMoqProduct, checkoutRequest } = await import('@/lib/test/harness');

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

/** Two admins hitting Cancel on the same order before either request returns. */
async function cancelTwiceConcurrently(orderId: string) {
  return Promise.allSettled([
    PATCH(cancelReq(), ctx(orderId)),
    PATCH(cancelReq(), ctx(orderId)),
  ]);
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('concurrent cancel of the same order', () => {
  it('releases kahati vials once, not twice', async () => {
    const gb = await makeGroupBuy({ totalSlots: 20, claimedSlots: 0, minVials: 1 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'group_buy', refId: gb.id, qty: 3 }]);
    await signIn('customer');
    await checkout([{ kind: 'group_buy', refId: gb.id, qty: 5 }]);
    expect((await claimedOf(gb.id))).toBe(8);

    await signIn('admin');
    await cancelTwiceConcurrently(orderId);

    // Only the 3 vials the cancelled order held come back. The other order's 5
    // are still claimed by a customer who is still paying for them.
    expect(await claimedOf(gb.id)).toBe(5);
  });

  it('restocks an on-hand line once, not twice', async () => {
    const p = await makeProduct({ stock: 20 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'product', refId: p.id, qty: 3, unit: 'piece' }]);
    expect((await productRow(p.id)).stock).toBe(17);

    await signIn('admin');
    await cancelTwiceConcurrently(orderId);

    const row = await productRow(p.id);
    expect(row.stock).toBe(20);
    expect(row.soldCount).toBe(0);
  });

  it('takes an MOQ commitment off the counter once, not twice', async () => {
    const mp = await makeMoqProduct({ committed: 0 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'moq_product', refId: mp.id, qty: 2 }]);
    await signIn('customer');
    await checkout([{ kind: 'moq_product', refId: mp.id, qty: 4 }]);
    expect(await committedOf(mp.id)).toBe(6);

    await signIn('admin');
    await cancelTwiceConcurrently(orderId);

    expect(await committedOf(mp.id)).toBe(4);
  });

  it('still leaves the order cancelled', async () => {
    const gb = await makeGroupBuy({ totalSlots: 20, claimedSlots: 0, minVials: 1 });
    await signIn('customer');
    const orderId = await checkout([{ kind: 'group_buy', refId: gb.id, qty: 3 }]);

    await signIn('admin');
    const results = await cancelTwiceConcurrently(orderId);

    // Whatever the interleaving, the customer-visible outcome is one cancelled
    // order — a lost race must not surface as a 500 to the admin who clicked.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const { orders } = await import('@/lib/db');
    const db = await getDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(row.status).toBe('cancelled');
  });
});

async function claimedOf(id: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row.claimedSlots;
}

async function committedOf(id: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select().from(moqProducts).where(eq(moqProducts.id, id));
  return row.committed;
}

async function productRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row;
}
