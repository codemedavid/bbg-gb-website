// Adding a proof of payment to an order that already exists.
//
// The gap this closes: a customer whose bank caps each transfer at ₱2,000 does
// not make all three transfers in the same minute. They pay ₱2,000 now, ₱1,500
// tonight, ₱1,000 tomorrow — and until this route existed they could only
// evidence whatever they happened to hold at the moment of checkout.
//
// The five-proof cap has to hold ACROSS visits. Five separate uploads of one
// file each must be refused on the sixth exactly as six at once are, or the cap
// is only a cap on how fast you click.
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
    requireAdmin: async () => requireSession(),
  };
});

const { POST: addProofs } = await import('./route');
const { POST: placeOrder } = await import('../../route');
const { GET: getOrder } = await import('../route');
const { resetDb, makeUser, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

/** The multipart Request this route expects. */
const addProofRequest = (count = 1): Request => {
  const form = new FormData();
  for (let i = 0; i < count; i++) {
    form.append('proof', new File([Buffer.from(`later-${i}`)], `later-${i}.png`, { type: 'image/png' }));
  }
  return new Request('http://localhost/api/orders/x/proofs', { method: 'POST', body: form });
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Place an order carrying `proofCount` proofs and return its row. */
async function placeWith(proofCount: number) {
  const product = await makeProduct();
  await placeOrder(checkoutRequest(
    [{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }],
    { proofCount },
  ));
  const { getDb, orders } = await import('@/lib/db');
  const [order] = await (await getDb()).select().from(orders);
  return order;
}

async function proofsOf(orderId: string) {
  const { getDb, orderPaymentProofs } = await import('@/lib/db');
  const { asc, eq } = await import('drizzle-orm');
  return (await getDb()).select().from(orderPaymentProofs)
    .where(eq(orderPaymentProofs.orderId, orderId))
    .orderBy(asc(orderPaymentProofs.sortOrder));
}

async function setStatus(orderId: string, status: string) {
  const { getDb, orders } = await import('@/lib/db');
  const { eq, sql } = await import('drizzle-orm');
  await (await getDb()).update(orders)
    .set({ status: sql.raw(`'${status}'::order_status`) as never })
    .where(eq(orders.id, orderId));
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('POST /api/orders/[id]/proofs — a payment made later', () => {
  it('attaches a proof to an order placed earlier', async () => {
    await signIn();
    const order = await placeWith(1);

    const res = await addProofs(addProofRequest(1), ctx(order.id));

    expect(res.status).toBe(201);
    expect(await proofsOf(order.id)).toHaveLength(2);
  });

  it('numbers the new proof after the ones already filed', async () => {
    // The whole point of a stable number. A second visit restarting at #1 would
    // give the admin two "Proof #1"s for one order.
    await signIn();
    const order = await placeWith(2);

    await addProofs(addProofRequest(1), ctx(order.id));

    expect((await proofsOf(order.id)).map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it('accepts several late proofs in one visit', async () => {
    await signIn();
    const order = await placeWith(1);

    await addProofs(addProofRequest(3), ctx(order.id));

    expect(await proofsOf(order.id)).toHaveLength(4);
  });

  it('builds up to five across separate visits', async () => {
    // Three visits, one file each, on top of two at checkout.
    await signIn();
    const order = await placeWith(2);

    await addProofs(addProofRequest(1), ctx(order.id));
    await addProofs(addProofRequest(1), ctx(order.id));
    await addProofs(addProofRequest(1), ctx(order.id));

    const proofs = await proofsOf(order.id);
    expect(proofs).toHaveLength(5);
    expect(proofs.map((p) => p.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it('refuses the sixth even though it arrives on its own visit', async () => {
    // The cap counts what is already filed, not what this request carries.
    await signIn();
    const order = await placeWith(5);

    const res = await addProofs(addProofRequest(1), ctx(order.id));

    expect(res.status).toBe(400);
    expect(await proofsOf(order.id)).toHaveLength(5);
  });

  it('refuses a batch that would overshoot, without filing part of it', async () => {
    await signIn();
    const order = await placeWith(4);

    const res = await addProofs(addProofRequest(3), ctx(order.id));

    expect(res.status).toBe(400);
    expect(await proofsOf(order.id)).toHaveLength(4);
  });

  it('says how many slots are left', async () => {
    await signIn();
    const order = await placeWith(4);

    const body = await (await addProofs(addProofRequest(3), ctx(order.id))).json();

    expect(body.error).toMatch(/1 more/i);
  });

  it('requires a file', async () => {
    await signIn();
    const order = await placeWith(1);

    const res = await addProofs(addProofRequest(0), ctx(order.id));

    expect(res.status).toBe(400);
  });

  it('refuses a file that is not an image or PDF', async () => {
    await signIn();
    const order = await placeWith(1);
    const form = new FormData();
    form.append('proof', new File([Buffer.from('#!/bin/sh')], 'run.sh', { type: 'application/x-sh' }));

    const res = await addProofs(
      new Request('http://localhost/x', { method: 'POST', body: form }),
      ctx(order.id),
    );

    expect(res.status).toBe(400);
  });
});

describe('POST /api/orders/[id]/proofs — who may add one', () => {
  it('refuses another customer\'s order', async () => {
    // Proofs are bank screenshots. Someone else's order is not a place to put
    // one, and not a place to read one either.
    await signIn();
    const order = await placeWith(1);

    await signIn(); // a different customer
    const res = await addProofs(addProofRequest(1), ctx(order.id));

    expect(res.status).toBe(403);
  });

  it('files nothing when it refuses a stranger', async () => {
    await signIn();
    const order = await placeWith(1);

    await signIn();
    await addProofs(addProofRequest(1), ctx(order.id));

    expect(await proofsOf(order.id)).toHaveLength(1);
  });

  it('refuses a signed-out visitor', async () => {
    await signIn();
    const order = await placeWith(1);

    session.current = null;
    const res = await addProofs(addProofRequest(1), ctx(order.id));

    expect(res.status).toBe(401);
  });

  it('404s an order that does not exist', async () => {
    await signIn();

    const res = await addProofs(
      addProofRequest(1),
      ctx('00000000-0000-0000-0000-000000000000'),
    );

    expect(res.status).toBe(404);
  });
});

describe('POST /api/orders/[id]/proofs — when an order still takes payment', () => {
  it('accepts one while the proof is under review', async () => {
    await signIn();
    const order = await placeWith(1);

    expect((await addProofs(addProofRequest(1), ctx(order.id))).status).toBe(201);
  });

  it('accepts one after payment was confirmed, for a customer topping up', async () => {
    await signIn();
    const order = await placeWith(1);
    await setStatus(order.id, 'payment_confirmed');

    expect((await addProofs(addProofRequest(1), ctx(order.id))).status).toBe(201);
  });

  it('accepts one while the batch is filling', async () => {
    await signIn();
    const order = await placeWith(1);
    await setStatus(order.id, 'batch_filling');

    expect((await addProofs(addProofRequest(1), ctx(order.id))).status).toBe(201);
  });

  it('refuses one on a shipped order', async () => {
    // The parcel has gone. Accepting a proof here tells the customer something
    // was settled when nothing was.
    await signIn();
    const order = await placeWith(1);
    await setStatus(order.id, 'shipped');

    expect((await addProofs(addProofRequest(1), ctx(order.id))).status).toBe(400);
  });

  it('refuses one on a delivered order', async () => {
    await signIn();
    const order = await placeWith(1);
    await setStatus(order.id, 'delivered');

    expect((await addProofs(addProofRequest(1), ctx(order.id))).status).toBe(400);
  });

  it('refuses one on a cancelled order', async () => {
    await signIn();
    const order = await placeWith(1);
    await setStatus(order.id, 'cancelled');

    expect((await addProofs(addProofRequest(1), ctx(order.id))).status).toBe(400);
  });
});

describe('POST /api/orders/[id]/proofs — what it must not disturb', () => {
  it('leaves a confirmed order confirmed', async () => {
    // Reverting to proof_review would undo the admin's verification every time
    // a customer uploaded, which is a worse failure than a late notification.
    await signIn();
    const order = await placeWith(1);
    await setStatus(order.id, 'payment_confirmed');

    await addProofs(addProofRequest(1), ctx(order.id));

    const { getDb, orders } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const [after] = await (await getDb()).select().from(orders).where(eq(orders.id, order.id));
    expect(after.status).toBe('payment_confirmed');
  });

  it('records the upload in the order history so the admin can see it happened', async () => {
    // Without this a new thumbnail simply appears, and nobody knows when or why.
    await signIn();
    const order = await placeWith(1);

    await addProofs(addProofRequest(1), ctx(order.id));

    const { getDb, orderStatusHistory } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const history = await (await getDb()).select().from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order.id));
    expect(history.some((h) => /proof/i.test(h.note ?? ''))).toBe(true);
  });

  it('leaves the legacy single proof key pointing at the original', async () => {
    // That column means "the first proof". A later upload must not rewrite what
    // the five other readers of it show.
    await signIn();
    const order = await placeWith(1);

    await addProofs(addProofRequest(1), ctx(order.id));

    const { getDb, orders } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const [after] = await (await getDb()).select().from(orders).where(eq(orders.id, order.id));
    expect(after.paymentProofKey).toBe(order.paymentProofKey);
  });
});

describe('GET /api/orders/[id] — the customer sees what they have sent', () => {
  it('returns every proof, not just the first', async () => {
    // The customer needs to know they already filed two before deciding whether
    // to upload a third.
    await signIn();
    const order = await placeWith(2);

    const res = await getOrder(new Request('http://localhost'), ctx(order.id));
    const data = (await res.json()).data as { proofs: { url: string; sortOrder: number }[] };

    expect(data.proofs).toHaveLength(2);
    expect(data.proofs.map((p) => p.sortOrder)).toEqual([0, 1]);
  });

  it('gives each one a fetchable URL, never a raw storage key', async () => {
    await signIn();
    const order = await placeWith(2);

    const res = await getOrder(new Request('http://localhost'), ctx(order.id));
    const data = (await res.json()).data as { proofs: { url: string }[] };

    expect(data.proofs.every((p) => !!p.url)).toBe(true);
    expect(new Set(data.proofs.map((p) => p.url)).size).toBe(2);
  });

  it('reflects a proof added later', async () => {
    await signIn();
    const order = await placeWith(1);
    await addProofs(addProofRequest(1), ctx(order.id));

    const res = await getOrder(new Request('http://localhost'), ctx(order.id));
    const data = (await res.json()).data as { proofs: unknown[] };

    expect(data.proofs).toHaveLength(2);
  });
});
