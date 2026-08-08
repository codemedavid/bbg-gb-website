// Admin side of the hatian final checkout: seeing who owes what, and flipping a
// verified settlement to Paid — the moment the packing fee stops reading Unpaid.
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

const { GET } = await import('./route');
const { PATCH } = await import('./[id]/route');
const { POST: SETTLE } = await import('../../settlements/route');
const { POST: CHECKOUT } = await import('../../orders/route');
const { GET: PREVIEW } = await import('../../settlements/preview/route');
const { resetDb, openBoards, makeUser, makeGroupBuy, makeProduct, checkoutRequest, settlementRequest } = await import('@/lib/test/harness');
const { getDb, groupBuys, orders, settlements } = await import('@/lib/db');

const asAdmin = async () => {
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
};

// A customer with one completed hatian order, already settled and awaiting
// verification. Returns the settlement id.
async function settledCustomer(): Promise<string> {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: 'customer', email: user.email };
  const gb = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150 });
  await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 3 }]));
  const db = await getDb();
  await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, gb.id));
  const body = await (await SETTLE(settlementRequest())).json();
  return body.data.settlement.id;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('GET /api/admin/settlements', () => {
  it('lists settlements with the customer and what they cover', async () => {
    await settledCustomer();
    await asAdmin();

    const body = await (await GET(new Request('http://localhost/api/admin/settlements'))).json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ status: 'proof_review', orderCount: 1 });
    // Nothing for packing: the fee was collected at checkout with the cycle
    // the commitment was made in, so the settlement covers the goods only.
    expect(Number(body.data[0].packingFeePhp)).toBe(0);
    expect(body.data[0].customerEmail).toBeTruthy();
  });

  it('refuses a customer', async () => {
    const user = await makeUser({ role: 'customer' });
    session.current = { sub: user.id, role: 'customer', email: user.email };
    const res = await GET(new Request('http://localhost/api/admin/settlements'));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/settlements/[id]', () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const patch = (status: string) =>
    new Request('http://localhost/api/admin/settlements/x', {
      method: 'PATCH', body: JSON.stringify({ status }), headers: { 'content-type': 'application/json' },
    });

  it('marks the settlement paid and stamps when it was confirmed', async () => {
    const id = await settledCustomer();
    await asAdmin();

    const res = await PATCH(patch('paid'), ctx(id));
    expect(res.status).toBe(200);

    const db = await getDb();
    const [row] = await db.select().from(settlements).where(eq(settlements.id, id));
    expect(row.status).toBe('paid');
    expect(row.paidAt).toBeTruthy();
  });

  it('releases the orders when a settlement is cancelled, so they can be settled again', async () => {
    // The release is by status, not by erasing the link — the link is the only
    // record of what this settlement covered. What matters is that the customer
    // can settle those orders again, which the preview below proves.
    const id = await settledCustomer();
    const customerSession = session.current;
    await asAdmin();

    await PATCH(patch('cancelled'), ctx(id));

    session.current = customerSession;
    const quote = await (await PREVIEW()).json();
    expect(quote.data.orders.length).toBeGreaterThan(0);
    // Still no packing fee to quote — cancelling a settlement releases the
    // orders, it does not un-pay a fee that was collected at checkout.
    expect(quote.data.totals.packingFeePhp).toBe(0);
    expect(quote.data.totals.balancePhp).toBeGreaterThan(0);
  });

  it('re-attaches the released orders when a cancelled settlement is confirmed after all', async () => {
    // Cancelling releases the orders. Confirming afterwards must take them back,
    // or the customer is emailed "no balance left" while their orders still read
    // unpaid and get quoted a second packing fee on the next visit to /settle.
    const id = await settledCustomer();
    await asAdmin();

    await PATCH(patch('cancelled'), ctx(id));
    await PATCH(patch('paid'), ctx(id));

    const db = await getDb();
    const rows = await db.select().from(orders);
    expect(rows.every((o) => o.settlementId === id)).toBe(true);
  });

  it('does not swallow the customer’s other orders when a cancelled settlement is confirmed', async () => {
    // Re-attaching by "every unsettled order this customer has" sweeps in orders
    // the settlement never covered — a solo on-hand order, or a hatian they
    // joined after the cancellation — marking them paid for by money that never
    // covered them.
    const id = await settledCustomer(); // session is still that customer
    const db = await getDb();
    const covered = (await db.select().from(orders)).map((o) => o.id);

    // The same customer buys ready stock after the settlement was made.
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    await CHECKOUT(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }]));

    await asAdmin();
    await PATCH(patch('cancelled'), ctx(id));
    await PATCH(patch('paid'), ctx(id));

    const after = await db.select().from(orders);
    const attached = after.filter((o) => o.settlementId === id).map((o) => o.id).sort();
    expect(attached).toEqual(covered.sort());
    // The on-hand order stays free of the hatian settlement entirely.
    const solo = after.find((o) => o.buyType === 'solo')!;
    expect(solo.settlementId).toBeNull();
  });

  it('lets a cancelled settlement’s orders be settled again by the customer', async () => {
    const id = await settledCustomer();
    const customerSession = session.current;
    await asAdmin();
    await PATCH(patch('cancelled'), ctx(id));

    session.current = customerSession; // back to the customer
    const quote = await (await PREVIEW()).json();
    expect(quote.data.orders.length).toBeGreaterThan(0);
  });

  it('keeps the confirmation timestamp when a paid settlement is edited', async () => {
    // A notes-only update must not wipe paidAt — the participants panel reads it
    // as "settled on".
    const id = await settledCustomer();
    await asAdmin();
    await PATCH(patch('paid'), ctx(id));

    const db = await getDb();
    const [confirmed] = await db.select().from(settlements).where(eq(settlements.id, id));
    const stampedAt = confirmed.paidAt;

    await PATCH(new Request('http://localhost/api/admin/settlements/x', {
      method: 'PATCH', body: JSON.stringify({ status: 'paid', notes: 'received via GCash' }),
      headers: { 'content-type': 'application/json' },
    }), ctx(id));

    const [after] = await db.select().from(settlements).where(eq(settlements.id, id));
    expect(after.paidAt).toEqual(stampedAt);
    expect(after.notes).toBe('received via GCash');
  });

  it('refuses a customer', async () => {
    const id = await settledCustomer();
    const res = await PATCH(patch('paid'), ctx(id));
    expect(res.status).toBe(403);
  });

  it('404s on an unknown settlement', async () => {
    await asAdmin();
    const res = await PATCH(patch('paid'), ctx('00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
  });
});
