// What the checkout screen asks before it decides whether to collect money:
// the kahati commitments this customer already holds, and whether that means
// the downpayment is already covered.
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

const { GET } = await import('./route');
const { POST: placeOrder } = await import('../../orders/route');
const { getDb, groupBuys } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const commitments = async () => (await (await GET()).json()).data;

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('GET /api/kahati/commitments', () => {
  it('requires a signed-in customer', async () => {
    expect((await GET()).status).toBe(401);
  });

  it('reports nothing for a customer who has never joined a hatian', async () => {
    await signIn();

    const data = await commitments();

    expect(data.paidThisCycle).toBe(false);
    expect(data.summary).toMatchObject({ vials: 0, totalPhp: 0, orderCount: 0 });
    expect(data.commitments).toEqual([]);
  });

  it('reports the cycle fee as paid once a commitment exists', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ name: 'Reta 20mg', minVials: 1, pricePerKitPhp: 9000 });
    await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 2 }]));

    const data = await commitments();

    expect(data.paidThisCycle).toBe(true);
  });

  it('totals what the customer already holds on each hatian', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ name: 'Reta 20mg', minVials: 1, pricePerKitPhp: 9000 });
    await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 2 }]));
    await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 3 }], { withProof: false }));

    const data = await commitments();

    // 5 vials at ₱900 each — one line per hatian name, both orders counted.
    expect(data.summary.vials).toBe(5);
    expect(data.summary.totalPhp).toBe(4500);
    expect(data.summary.orderCount).toBe(2);
    expect(data.summary.groups).toHaveLength(1);
    expect(data.summary.groups[0]).toMatchObject({ kahatiName: 'Reta 20mg', vials: 5 });
  });

  it('keeps reporting the cycle fee as paid after the hatians seal', async () => {
    await signIn();
    const kahati = await makeGroupBuy({ name: 'Reta 20mg', minVials: 1, pricePerKitPhp: 9000 });
    await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 2 }]));
    const db = await getDb();
    await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, kahati.id));

    const data = await commitments();

    // The fee follows the CYCLE, not the counter. A hatian sealing mid-cycle
    // does not entitle anyone to charge for the same parcel a second time.
    expect(data.paidThisCycle).toBe(true);
    // The commitment itself still shows: the customer has those vials on order.
    expect(data.summary.vials).toBe(2);
  });

  it('never reports another customer\'s commitments', async () => {
    const kahati = await makeGroupBuy({ name: 'Reta 20mg', minVials: 1, pricePerKitPhp: 9000 });
    await signIn();
    await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 2 }]));

    await signIn(); // a different customer

    const data = await commitments();
    expect(data.paidThisCycle).toBe(false);
    expect(data.commitments).toEqual([]);
  });
});
