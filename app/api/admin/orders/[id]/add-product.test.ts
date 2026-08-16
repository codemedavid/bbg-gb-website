// An admin adding a real catalog product to a customer's order.
//
// The order editor could already add a line, but only a FREE-TEXT one: a typed
// name and a typed price, with no product behind it. That line drew no stock,
// carried no USD price, and — because the weekly rollup groups by productId and
// falls back to the name snapshot — landed in the batch order as its own row
// with no price-list code and a kit size of 1. An admin adding 30 vials of a
// 10-vial-kit product reported as 30 kits to order instead of 3.
//
// A product-linked line behaves like one checkout wrote, because it is built by
// the same rules.
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
const { POST: CHECKOUT } = await import('../../../orders/route');
const { getDb, orders, orderItems, products } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

/** A customer order for one piece of `product`, then switch to an admin session. */
async function anOrder() {
  const customer = await makeUser({ role: 'customer' });
  session.current = { sub: customer.id, role: 'customer', email: customer.email };
  const bought = await makeProduct({ stock: 50 });
  const res = await CHECKOUT(checkoutRequest([{ kind: 'product', refId: bought.id, qty: 1, unit: 'piece' }]));
  expect(res.status).toBe(201);

  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.userId, customer.id));
  const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
  return { order, line, bought };
}

const keep = (line: { id: string; nameSnapshot: string; qty: number; unitPricePhp: string }) => ({
  id: line.id, nameSnapshot: line.nameSnapshot, qty: line.qty, unitPricePhp: Number(line.unitPricePhp),
});

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('PATCH /api/admin/orders/[id] — adding a catalog product', () => {
  it('links the new line to the product it names', async () => {
    const { order, line } = await anOrder();
    const added = await makeProduct({ name: 'Retatrutide', spec: '20mg', stock: 40, code: 'RT20' });

    const res = await patch(order.id, {
      items: [keep(line), { productId: added.id, qty: 3, unit: 'piece' }],
    });
    expect(res.status).toBe(200);

    const db = await getDb();
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const newLine = lines.find((l) => l.productId === added.id);
    expect(newLine).toBeTruthy();
    expect(newLine!.qty).toBe(3);
    expect(newLine!.kind).toBe('product');
  });

  it('draws the added quantity out of stock', async () => {
    const { order, line } = await anOrder();
    const added = await makeProduct({ stock: 40 });

    await patch(order.id, { items: [keep(line), { productId: added.id, qty: 3, unit: 'piece' }] });

    const db = await getDb();
    const [after] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, added.id));
    expect(after.stock).toBe(37);
  });

  it('draws a whole kit of vials for a kit line', async () => {
    const { order, line } = await anOrder();
    const added = await makeProduct({ stock: 40 });

    const res = await patch(order.id, { items: [keep(line), { productId: added.id, qty: 1, unit: 'kit' }] });
    expect(res.status).toBe(200);

    const db = await getDb();
    const [after] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, added.id));
    expect(after.stock).toBe(30);
  });

  // The whole point: the price is the catalog's, so a mistyped figure cannot
  // become what the customer is billed.
  it('prices the line from the product, not from the request', async () => {
    const { order, line } = await anOrder();
    const added = await makeProduct({ stock: 40 });
    const db = await getDb();
    const [row] = await db.select().from(products).where(eq(products.id, added.id));

    await patch(order.id, {
      items: [keep(line), { productId: added.id, qty: 2, unit: 'piece', unitPricePhp: 1, nameSnapshot: 'FREE' }],
    });

    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const newLine = lines.find((l) => l.productId === added.id)!;
    expect(Number(newLine.unitPricePhp)).toBe(Number(row.onHandPiecePhp));
    expect(newLine.nameSnapshot).not.toBe('FREE');
    expect(newLine.nameSnapshot).toContain(row.name);
  });

  it('carries a USD price so the batch order can be costed', async () => {
    const { order, line } = await anOrder();
    const added = await makeProduct({ stock: 40, priceUsd: '9.50' });

    await patch(order.id, { items: [keep(line), { productId: added.id, qty: 2, unit: 'piece' }] });

    const db = await getDb();
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const newLine = lines.find((l) => l.productId === added.id)!;
    expect(Number(newLine.unitPriceUsd)).toBe(9.5);
  });

  it('adds the new line into the order total', async () => {
    const { order, line } = await anOrder();
    const added = await makeProduct({ stock: 40 });
    const db = await getDb();
    const [row] = await db.select().from(products).where(eq(products.id, added.id));

    const res = await patch(order.id, {
      items: [keep(line), { productId: added.id, qty: 2, unit: 'piece' }],
    });
    const body = await res.json();

    const expected = Number(line.unitPricePhp) * line.qty + Number(row.onHandPiecePhp) * 2;
    expect(Number(body.data.order.subtotalPhp)).toBe(expected);
  });

  it('refuses to add more than the stock that is left', async () => {
    const { order, line } = await anOrder();
    const added = await makeProduct({ stock: 2 });

    const res = await patch(order.id, { items: [keep(line), { productId: added.id, qty: 99, unit: 'piece' }] });
    expect(res.status).toBe(409);

    // …and the order is untouched, not half-edited.
    const db = await getDb();
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines).toHaveLength(1);
  });

  it('refuses a product that no longer exists', async () => {
    const { order, line } = await anOrder();

    const res = await patch(order.id, {
      items: [keep(line), { productId: crypto.randomUUID(), qty: 1, unit: 'piece' }],
    });
    expect(res.status).toBe(400);
  });

  // The old behaviour has to keep working: not every correction has a catalog
  // row behind it.
  it('still accepts a free-text manual line with no product', async () => {
    const { order, line } = await anOrder();

    const res = await patch(order.id, {
      items: [keep(line), { nameSnapshot: 'Courier surcharge', qty: 1, unitPricePhp: 120 }],
    });
    expect(res.status).toBe(200);

    const db = await getDb();
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const manual = lines.find((l) => l.nameSnapshot === 'Courier surcharge')!;
    expect(manual.productId).toBeNull();
    expect(Number(manual.unitPricePhp)).toBe(120);
  });

  it('refuses an unnamed manual line rather than billing a blank row', async () => {
    const { order, line } = await anOrder();

    const res = await patch(order.id, { items: [keep(line), { qty: 1, unitPricePhp: 500 }] });
    expect(res.status).toBe(400);
  });

  it('gives stock back when the admin deletes a product line', async () => {
    const { order, line, bought } = await anOrder();
    const db = await getDb();
    const [before] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, bought.id));

    // Replace the only line with a different product: the old one is dropped.
    const added = await makeProduct({ stock: 40 });
    const res = await patch(order.id, { items: [{ productId: added.id, qty: 1, unit: 'piece' }] });
    expect(res.status).toBe(200);

    const [after] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, bought.id));
    expect(after.stock).toBe(before.stock + line.qty);
  });

  it('refuses a customer trying to reach the admin editor', async () => {
    const { order, line } = await anOrder();
    const customer = await makeUser({ role: 'customer' });
    session.current = { sub: customer.id, role: 'customer', email: customer.email };

    const res = await patch(order.id, { items: [keep(line)] });
    expect(res.status).toBe(403);
  });
});
