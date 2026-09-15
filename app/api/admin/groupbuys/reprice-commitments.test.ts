// A hatian counter's price comes DOWN after people have already joined it.
//
// Client report (KH-2737, Sep 2026): "Si TF15 salt form - 450, pero ang binayad
// ko 630/pc". Her counter was at ₱6,300/kit when she committed 6 vials, an admin
// corrected it to ₱4,500 two days later, and the next customer on the SAME
// counter paid ₱450. Editing the counter only rewrote the counter row — every
// line already on it kept the old price, so two people splitting one kit paid
// different money for the same vial, and nothing told anyone.
//
// Rule the client chose: a price that falls is passed on to everyone already on
// the counter; a price that rises never charges an earlier buyer more than they
// agreed to.
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
    ApiError, getSession: async () => session.current, requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST: checkout } = await import('../../orders/route');
const { PATCH: patchCounter } = await import('./[id]/route');
const { PATCH: patchProduct } = await import('../products/[id]/route');
const { getDb, orders, orderItems, orderStatusHistory } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeGroupBuy, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonPatch = (body: unknown) => new Request('http://localhost/x', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

async function signInAs(role: 'customer' | 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

/** A customer commits `qty` vials to the counter; returns their order. */
async function commit(counterId: string, qty: number) {
  const customer = await signInAs('customer');
  const res = await checkout(checkoutRequest([{ kind: 'group_buy', refId: counterId, qty }]));
  expect(res.status).toBe(201);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.userId, customer.id));
  return order;
}

async function linesOf(orderId: string) {
  const db = await getDb();
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
}

async function orderById(orderId: string) {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  return order;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('admin lowers a hatian counter price after customers joined', () => {
  it('passes the lower per-vial price on to vials already committed', async () => {
    const counter = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 6300, name: 'Tirzepatide (Salt Form) 15 mg' });
    const placed = await commit(counter.id, 6);
    expect(Number((await linesOf(placed.id))[0].unitPricePhp)).toBe(630);

    await signInAs('admin');
    const res = await patchCounter(jsonPatch({ pricePerKitPhp: 4500 }), ctx(counter.id));
    expect(res.status).toBe(200);

    const [line] = await linesOf(placed.id);
    expect(Number(line.unitPricePhp)).toBe(450);
    expect(Number(line.lineTotalPhp)).toBe(2700);
  });

  it('re-totals the order by exactly the difference, keeping its packing fee', async () => {
    const counter = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 6300 });
    const placed = await commit(counter.id, 6);

    await signInAs('admin');
    await patchCounter(jsonPatch({ pricePerKitPhp: 4500 }), ctx(counter.id));

    const after = await orderById(placed.id);
    expect(Number(after.subtotalPhp)).toBe(2700);
    expect(Number(after.packingFeePhp)).toBe(Number(placed.packingFeePhp));
    expect(Number(after.totalPhp)).toBe(Number(placed.totalPhp) - 1080);
  });

  it('leaves a note on the order saying why its price changed', async () => {
    const counter = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 6300 });
    const placed = await commit(counter.id, 6);

    await signInAs('admin');
    await patchCounter(jsonPatch({ pricePerKitPhp: 4500 }), ctx(counter.id));

    const db = await getDb();
    const notes = (await db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, placed.id)))
      .map((h) => h.note ?? '');
    expect(notes.some((n) => n.includes('₱630') && n.includes('₱450'))).toBe(true);
  });

  it('does not touch the payment status of an order that was already confirmed', async () => {
    const counter = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 6300 });
    const placed = await commit(counter.id, 6);
    const db = await getDb();
    await db.update(orders).set({ paymentStatus: 'confirmed', status: 'payment_confirmed' }).where(eq(orders.id, placed.id));

    await signInAs('admin');
    await patchCounter(jsonPatch({ pricePerKitPhp: 4500 }), ctx(counter.id));

    const after = await orderById(placed.id);
    expect(after.paymentStatus).toBe('confirmed');
    expect(after.status).toBe('payment_confirmed');
  });

  it('does not reprice a cancelled order', async () => {
    const counter = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 6300 });
    const placed = await commit(counter.id, 2);
    const db = await getDb();
    await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, placed.id));

    await signInAs('admin');
    await patchCounter(jsonPatch({ pricePerKitPhp: 4500 }), ctx(counter.id));

    expect(Number((await linesOf(placed.id))[0].unitPricePhp)).toBe(630);
  });
});

describe('admin raises a hatian counter price after customers joined', () => {
  it('keeps the price an earlier buyer agreed to', async () => {
    const counter = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 4500 });
    const placed = await commit(counter.id, 3);

    await signInAs('admin');
    const res = await patchCounter(jsonPatch({ pricePerKitPhp: 6300 }), ctx(counter.id));
    expect(res.status).toBe(200);

    const [line] = await linesOf(placed.id);
    expect(Number(line.unitPricePhp)).toBe(450);
    expect(Number((await orderById(placed.id)).totalPhp)).toBe(Number(placed.totalPhp));
  });
});

describe('a product repricing that reaches an open counter', () => {
  it('passes a lower group buy kit price on to vials already committed there', async () => {
    const product = await makeProduct({
      name: 'Tirzepatide (Salt Form)', spec: '15 mg', isKahati: true,
      pricePhp: 6300, gbPricePerKitPhp: 6300, gbVialsPerKit: 10,
    });
    const counter = await makeGroupBuy({ productId: product.id, totalSlots: 10, minVials: 1, pricePerKitPhp: 6300 });
    const placed = await commit(counter.id, 6);

    await signInAs('admin');
    const res = await patchProduct(jsonPatch({ pricePhp: 4500, gbPricePerKitPhp: 4500 }), ctx(product.id));
    expect(res.status).toBe(200);

    expect(Number((await linesOf(placed.id))[0].unitPricePhp)).toBe(450);
    expect(Number((await orderById(placed.id)).subtotalPhp)).toBe(2700);
  });
});
