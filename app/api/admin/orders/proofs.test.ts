// The admin has to see every proof of an order, not just the first.
//
// §12: a customer who paid a ₱4,500 order in three transfers uploaded three
// screenshots, and the admin verifying the payment needs all three — one of
// them alone shows ₱2,000 against a ₱4,500 total and reads as underpaid.
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
      if (s.role !== 'admin') throw new ApiError(403, 'Admin only.');
      return s;
    },
  };
});

const { GET: getOrder } = await import('./[id]/route');
const { POST: placeOrder } = await import('../../orders/route');
const { resetDb, makeUser, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

async function signInAs(role: 'customer' | 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

/** Place an order carrying `proofCount` proofs, then read it back as admin. */
async function orderWithProofs(proofCount: number) {
  await signInAs('customer');
  const product = await makeProduct();
  await placeOrder(checkoutRequest(
    [{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }],
    { proofCount },
  ));

  const { getDb, orders } = await import('@/lib/db');
  const [order] = await (await getDb()).select().from(orders);

  await signInAs('admin');
  const res = await getOrder(new Request('http://localhost'), { params: Promise.resolve({ id: order.id }) });
  return (await res.json()).data as {
    proofUrl: string | null;
    proofs: { url: string; sortOrder: number; amountPhp: string | null; reference: string | null }[];
  };
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('GET /api/admin/orders/[id] — payment proofs', () => {
  it('returns the single proof of a single-proof order', async () => {
    const data = await orderWithProofs(1);

    expect(data.proofs).toHaveLength(1);
  });

  it('returns all three proofs of an order paid in three transfers', async () => {
    const data = await orderWithProofs(3);

    expect(data.proofs).toHaveLength(3);
  });

  it('returns all five when five were attached', async () => {
    const data = await orderWithProofs(5);

    expect(data.proofs).toHaveLength(5);
  });

  it('gives each proof its own openable URL', async () => {
    // Three rows pointing at one URL would show the admin the same screenshot
    // three times and read as a match.
    const data = await orderWithProofs(3);

    const urls = data.proofs.map((p) => p.url);
    expect(urls.every(Boolean)).toBe(true);
    expect(new Set(urls).size).toBe(3);
  });

  it('orders them so "Proof #1" means what the customer uploaded first', async () => {
    const data = await orderWithProofs(3);

    expect(data.proofs.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it('carries the amount and reference fields the admin reconciles into', async () => {
    // Null until someone reads the bank statement — but present, or the admin
    // has nowhere to record that proof #2 was the ₱1,500 one.
    const data = await orderWithProofs(2);

    expect(data.proofs[0]).toHaveProperty('amountPhp', null);
    expect(data.proofs[0]).toHaveProperty('reference', null);
  });

  it('still answers with the legacy single proofUrl', async () => {
    // Kept so nothing that reads it breaks while the drawer moves over.
    const data = await orderWithProofs(2);

    expect(data.proofUrl).toBeTruthy();
  });

  it('returns an empty list for an order with no proof at all', async () => {
    // A kahati order whose downpayment was waived collected nothing. An empty
    // list is the honest answer; the drawer explains why.
    await signInAs('customer');
    const product = await makeProduct();
    await placeOrder(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }]));

    const { getDb, orders, orderPaymentProofs } = await import('@/lib/db');
    const db = await getDb();
    const [order] = await db.select().from(orders);
    await db.delete(orderPaymentProofs);

    await signInAs('admin');
    const res = await getOrder(new Request('http://localhost'), { params: Promise.resolve({ id: order.id }) });
    const data = (await res.json()).data as { proofs: unknown[] };

    expect(data.proofs).toEqual([]);
  });

  it('refuses a customer asking for someone\'s order', async () => {
    // The proofs are bank screenshots. Widening what this route returns must
    // not widen who may read it.
    await signInAs('customer');
    const product = await makeProduct();
    await placeOrder(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }]));

    const { getDb, orders } = await import('@/lib/db');
    const [order] = await (await getDb()).select().from(orders);

    const res = await getOrder(new Request('http://localhost'), { params: Promise.resolve({ id: order.id }) });

    expect(res.status).toBe(403);
  });
});
