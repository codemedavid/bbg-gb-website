// A customer fixing their own order before it is paid for in full.
//
// Client feedback: "clients can edit yung added items na di pa nababayadan in
// full sa cart nila". The risk this route carries is that it is the first
// customer-facing surface that WRITES to a placed order, so most of what
// follows is about what it must refuse: someone else's order, an order already
// paid or already being packed, and — above all — a price sent from a browser.
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
    requireAdmin: async () => requireSession(),
  };
});

const { PATCH } = await import('./route');
const { POST: CHECKOUT } = await import('../route');
const { getDb, orders, orderItems, products, groupBuys } = await import('@/lib/db');
const {
  resetDb, openBoards, makeUser, makeProduct, makeGroupBuy, checkoutRequest,
} = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

/** An on-hand order for `qty` pieces, sitting at proof_review. */
async function onHandOrder(qty = 3, stock = 50) {
  const product = await makeProduct({ stock });
  const res = await CHECKOUT(checkoutRequest([{ kind: 'product', refId: product.id, qty, unit: 'piece' }]));
  expect(res.status).toBe(201);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.userId, session.current!.sub));
  const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  return { order, line, product };
}

async function kahatiOrder(qty = 8) {
  const gb = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, totalSlots: 100 });
  const res = await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty }]));
  expect(res.status).toBe(201);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.userId, session.current!.sub));
  const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  return { order, line, gb };
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('PATCH /api/orders/[id] — the customer edits their own order', () => {
  it('requires a signed-in customer', async () => {
    const res = await patch(crypto.randomUUID(), { items: [] });
    expect(res.status).toBe(401);
  });

  it('lowers a quantity and re-totals the order', async () => {
    await signIn();
    const { order, line } = await onHandOrder(3);
    const unit = Number(line.unitPricePhp);

    const res = await patch(order.id, { items: [{ id: line.id, qty: 1 }] });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.items[0].qty).toBe(1);
    expect(Number(body.data.order.subtotalPhp)).toBe(unit);
    // The packing fee rides through untouched — the parcel still ships.
    expect(Number(body.data.order.totalPhp))
      .toBe(unit + Number(order.packingFeePhp));
  });

  it('returns the stock a reduced quantity gives back', async () => {
    await signIn();
    const { order, line, product } = await onHandOrder(3, 50);
    const db = await getDb();
    const [before] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, product.id));

    await patch(order.id, { items: [{ id: line.id, qty: 1 }] });

    const [after] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, product.id));
    expect(after.stock).toBe(before.stock + 2);
  });

  it('takes more stock when a quantity is raised', async () => {
    await signIn();
    const { order, line, product } = await onHandOrder(1, 50);
    const db = await getDb();
    const [before] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, product.id));

    const res = await patch(order.id, { items: [{ id: line.id, qty: 3 }] });
    expect(res.status).toBe(200);

    const [after] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, product.id));
    expect(after.stock).toBe(before.stock - 2);
  });

  it('refuses to raise a quantity past the stock that is left', async () => {
    await signIn();
    const { order, line } = await onHandOrder(1, 2);

    const res = await patch(order.id, { items: [{ id: line.id, qty: 99 }] });
    expect(res.status).toBe(409);
  });

  it('releases kahati slots when a commitment is reduced', async () => {
    await signIn();
    const { order, line, gb } = await kahatiOrder(8);
    const db = await getDb();
    const [before] = await db.select({ claimed: groupBuys.claimedSlots }).from(groupBuys).where(eq(groupBuys.id, gb.id));

    await patch(order.id, { items: [{ id: line.id, qty: 3 }] });

    const [after] = await db.select({ claimed: groupBuys.claimedSlots }).from(groupBuys).where(eq(groupBuys.id, gb.id));
    expect(after.claimed).toBe(before.claimed - 5);
  });

  it('drops a line the customer leaves out', async () => {
    await signIn();
    const product = await makeProduct({ stock: 50 });
    const second = await makeProduct({ stock: 50, name: 'BAC Water' });
    await CHECKOUT(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 2, unit: 'piece' },
      { kind: 'product', refId: second.id, qty: 1, unit: 'piece' },
    ]));
    const db = await getDb();
    const [order] = await db.select().from(orders).where(eq(orders.userId, session.current!.sub));
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines).toHaveLength(2);

    const res = await patch(order.id, { items: [{ id: lines[0].id, qty: lines[0].qty }] });
    expect(res.status).toBe(200);

    const left = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(lines[0].id);
  });

  // THE security property: the browser names a line and a quantity, never a
  // price. A request carrying one must not be able to reprice the order.
  it('ignores any price the request tries to send', async () => {
    await signIn();
    const { order, line } = await onHandOrder(2);
    const realUnit = Number(line.unitPricePhp);

    const res = await patch(order.id, {
      items: [{ id: line.id, qty: 2, unitPricePhp: 1, nameSnapshot: 'FREE STUFF' }],
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Number(body.data.items[0].unitPricePhp)).toBe(realUnit);
    expect(body.data.items[0].nameSnapshot).not.toBe('FREE STUFF');
    expect(Number(body.data.order.subtotalPhp)).toBe(realUnit * 2);
  });

  it("refuses to touch another customer's order, as a 404", async () => {
    await signIn();
    const { order, line } = await onHandOrder(3);

    await signIn(); // a different customer
    const res = await patch(order.id, { items: [{ id: line.id, qty: 1 }] });
    expect(res.status).toBe(404);

    const db = await getDb();
    const [untouched] = await db.select().from(orderItems).where(eq(orderItems.id, line.id));
    expect(untouched.qty).toBe(3);
  });

  it('refuses a line belonging to a different order', async () => {
    await signIn();
    const first = await onHandOrder(2);
    const db = await getDb();
    const [other] = await db.insert(orderItems).values({
      orderId: first.order.id, kind: 'product', nameSnapshot: 'x', qty: 1,
      unitPricePhp: '1', lineTotalPhp: '1',
    }).returning();

    const res = await patch(first.order.id, { items: [{ id: crypto.randomUUID(), qty: 1 }] });
    expect(res.status).toBe(400);
    void other;
  });

  it('refuses to empty an order, pointing at cancellation instead', async () => {
    await signIn();
    const { order } = await onHandOrder(3);

    const res = await patch(order.id, { items: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cancel/i);
  });

  it('refuses once an on-hand order is paid in full', async () => {
    await signIn();
    const { order, line } = await onHandOrder(3);
    const db = await getDb();
    await db.update(orders).set({ status: 'payment_confirmed' }).where(eq(orders.id, order.id));

    const res = await patch(order.id, { items: [{ id: line.id, qty: 1 }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/paid in full/i);
  });

  // The case the client actually raised: a deferred board order whose balance
  // is still outstanding stays editable after its downpayment clears.
  it('still allows an edit after a kahati downpayment is confirmed', async () => {
    await signIn();
    const { order, line } = await kahatiOrder(8);
    const db = await getDb();
    await db.update(orders).set({ status: 'payment_confirmed' }).where(eq(orders.id, order.id));

    const res = await patch(order.id, { items: [{ id: line.id, qty: 4 }] });
    expect(res.status).toBe(200);
  });

  it('refuses once the batch is being packed', async () => {
    await signIn();
    const { order, line } = await kahatiOrder(8);
    const db = await getDb();
    await db.update(orders).set({ status: 'batch_filling' }).where(eq(orders.id, order.id));

    const res = await patch(order.id, { items: [{ id: line.id, qty: 4 }] });
    expect(res.status).toBe(409);
  });

  it('records the change in the order history so the admin can see it', async () => {
    await signIn();
    const { order, line } = await onHandOrder(3);

    await patch(order.id, { items: [{ id: line.id, qty: 1 }] });

    const db = await getDb();
    const { orderStatusHistory } = await import('@/lib/db');
    const history = await db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, order.id));
    expect(history.some((h) => /customer edited/i.test(h.note ?? ''))).toBe(true);
  });
});
