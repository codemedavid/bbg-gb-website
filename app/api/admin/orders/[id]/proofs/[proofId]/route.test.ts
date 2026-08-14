// The admin records what each transfer was worth.
//
// §13: a ₱4,500 order paid as ₱2,000 + ₱1,500 + ₱1,000 has to be reconcilable.
// The customer uploads pictures; only someone reading the bank statement can
// say which picture was the ₱1,500 one, so this is where that goes.
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

const { PATCH: setProofAmount } = await import('./route');
const { POST: placeOrder } = await import('../../../../../orders/route');
const { resetDb, makeUser, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

async function signInAs(role: 'customer' | 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const patch = (body: unknown) =>
  new Request('http://localhost/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const ctx = (id: string, proofId: string) => ({ params: Promise.resolve({ id, proofId }) });

/** An order with `n` proofs, returned with its rows. */
async function orderWithProofs(n: number) {
  await signInAs('customer');
  const product = await makeProduct();
  await placeOrder(checkoutRequest(
    [{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }],
    { proofCount: n },
  ));
  const { getDb, orders, orderPaymentProofs } = await import('@/lib/db');
  const { asc, eq } = await import('drizzle-orm');
  const db = await getDb();
  const [order] = await db.select().from(orders);
  const proofs = await db.select().from(orderPaymentProofs)
    .where(eq(orderPaymentProofs.orderId, order.id))
    .orderBy(asc(orderPaymentProofs.sortOrder));
  await signInAs('admin');
  return { order, proofs };
}

async function reread(proofId: string) {
  const { getDb, orderPaymentProofs } = await import('@/lib/db');
  const { eq } = await import('drizzle-orm');
  const [row] = await (await getDb()).select().from(orderPaymentProofs)
    .where(eq(orderPaymentProofs.id, proofId));
  return row;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('PATCH /api/admin/orders/[id]/proofs/[proofId]', () => {
  it('records the amount a transfer was worth', async () => {
    const { order, proofs } = await orderWithProofs(2);

    const res = await setProofAmount(patch({ amountPhp: 2000 }), ctx(order.id, proofs[0].id));

    expect(res.status).toBe(200);
    expect(Number((await reread(proofs[0].id)).amountPhp)).toBe(2000);
  });

  it('records the bank reference alongside it', async () => {
    const { order, proofs } = await orderWithProofs(1);

    await setProofAmount(patch({ amountPhp: 4500, reference: 'GC-88213' }), ctx(order.id, proofs[0].id));

    expect((await reread(proofs[0].id)).reference).toBe('GC-88213');
  });

  it('records amounts against each proof independently', async () => {
    // The whole point: three transfers, three different figures.
    const { order, proofs } = await orderWithProofs(3);

    await setProofAmount(patch({ amountPhp: 2000 }), ctx(order.id, proofs[0].id));
    await setProofAmount(patch({ amountPhp: 1500 }), ctx(order.id, proofs[1].id));
    await setProofAmount(patch({ amountPhp: 1000 }), ctx(order.id, proofs[2].id));

    expect(Number((await reread(proofs[0].id)).amountPhp)).toBe(2000);
    expect(Number((await reread(proofs[1].id)).amountPhp)).toBe(1500);
    expect(Number((await reread(proofs[2].id)).amountPhp)).toBe(1000);
  });

  it('lets an admin clear an amount they typed wrongly', async () => {
    const { order, proofs } = await orderWithProofs(1);
    await setProofAmount(patch({ amountPhp: 2000 }), ctx(order.id, proofs[0].id));

    await setProofAmount(patch({ amountPhp: null }), ctx(order.id, proofs[0].id));

    expect((await reread(proofs[0].id)).amountPhp).toBeNull();
  });

  it('returns the reconciliation so the admin sees the running total', async () => {
    // The figure §13 is actually about — is this order paid? Amounts are taken
    // from the order's own total so the split is a genuine part-payment rather
    // than a number that happens to be smaller.
    const { order, proofs } = await orderWithProofs(2);
    const total = Number(order.totalPhp);
    const first = Math.floor(total / 4);

    await setProofAmount(patch({ amountPhp: first }), ctx(order.id, proofs[0].id));
    const res = await setProofAmount(patch({ amountPhp: first }), ctx(order.id, proofs[1].id));
    const data = (await res.json()).data as { reconciliation: { recorded: number; outstanding: number; state: string } };

    expect(data.reconciliation.recorded).toBe(first * 2);
    expect(data.reconciliation.state).toBe('short');
    expect(data.reconciliation.outstanding).toBe(total - first * 2);
  });

  it('reports an order settled once the recorded amounts meet its total', async () => {
    const { order, proofs } = await orderWithProofs(2);
    const total = Number(order.totalPhp);
    const half = total / 2;

    await setProofAmount(patch({ amountPhp: half }), ctx(order.id, proofs[0].id));
    const res = await setProofAmount(patch({ amountPhp: half }), ctx(order.id, proofs[1].id));
    const data = (await res.json()).data as { reconciliation: { state: string; outstanding: number } };

    expect(data.reconciliation.state).toBe('settled');
    expect(data.reconciliation.outstanding).toBe(0);
  });

  it('refuses a negative amount', async () => {
    const { order, proofs } = await orderWithProofs(1);

    const res = await setProofAmount(patch({ amountPhp: -100 }), ctx(order.id, proofs[0].id));

    expect(res.status).toBe(400);
  });

  it('refuses a proof belonging to a different order', async () => {
    // The id pair has to agree, or a typo'd order id silently edits someone
    // else's payment record.
    const { proofs } = await orderWithProofs(1);

    const res = await setProofAmount(
      patch({ amountPhp: 100 }),
      ctx('00000000-0000-0000-0000-000000000000', proofs[0].id),
    );

    expect(res.status).toBe(404);
  });

  it('404s an unknown proof', async () => {
    const { order } = await orderWithProofs(1);

    const res = await setProofAmount(
      patch({ amountPhp: 100 }),
      ctx(order.id, '00000000-0000-0000-0000-000000000000'),
    );

    expect(res.status).toBe(404);
  });

  it('refuses a customer, even for their own order', async () => {
    // What a payment was worth is the shop's determination, not the payer's.
    const { order, proofs } = await orderWithProofs(1);
    await signInAs('customer');

    const res = await setProofAmount(patch({ amountPhp: 999999 }), ctx(order.id, proofs[0].id));

    expect(res.status).toBe(403);
  });

  it('writes nothing when it refuses a customer', async () => {
    const { order, proofs } = await orderWithProofs(1);
    await signInAs('customer');

    await setProofAmount(patch({ amountPhp: 999999 }), ctx(order.id, proofs[0].id));

    expect((await reread(proofs[0].id)).amountPhp).toBeNull();
  });
});
