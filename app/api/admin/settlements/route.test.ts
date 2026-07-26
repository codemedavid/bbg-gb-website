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
const { resetDb, makeUser, makeGroupBuy, checkoutRequest, settlementRequest } = await import('@/lib/test/harness');
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
});

describe('GET /api/admin/settlements', () => {
  it('lists settlements with the customer and what they cover', async () => {
    await settledCustomer();
    await asAdmin();

    const body = await (await GET(new Request('http://localhost/api/admin/settlements'))).json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ status: 'proof_review', orderCount: 1 });
    expect(Number(body.data[0].packingFeePhp)).toBe(150);
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
    const id = await settledCustomer();
    await asAdmin();

    await PATCH(patch('cancelled'), ctx(id));

    const db = await getDb();
    const rows = await db.select().from(orders);
    expect(rows.every((o) => o.settlementId === null)).toBe(true);
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
