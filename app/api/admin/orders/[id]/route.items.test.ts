import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  return { ApiError, requireAdmin: async () => ({ sub: 'admin', role: 'admin' }) };
});

vi.mock('@/lib/storage', () => ({ signedUrl: async () => 'signed-url' }));

const { PATCH } = await import('./route');
const { getDb, orders, orderItems, products } = await import('@/lib/db');
const { resetDb, makeUser } = await import('@/lib/test/harness');

beforeEach(resetDb);

async function seed(status = 'proof_review') {
  const db = await getDb();
  const user = await makeUser();
  const [order] = await db.insert(orders).values({
    orderNo: `BBG-${Math.floor(Math.random() * 80000) + 10000}`,
    userId: user.id,
    status: status as never,
    subtotalPhp: '500',
    packingFeePhp: '150',
    totalPhp: '650',
    shipName: 'Ana', shipPhone: '0917', shipAddress: 'Manila',
  }).returning();
  const [item] = await db.insert(orderItems).values({
    orderId: order.id, nameSnapshot: 'Original', specSnapshot: '10mg',
    unitPricePhp: '500', qty: 1, lineTotalPhp: '500',
  }).returning();
  return { order, item };
}

describe('admin order item editing', () => {
  it('edits, adds, deletes, and recalculates totals in one request', async () => {
    const { order, item } = await seed();
    const req = new Request(`http://localhost/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [
        { id: item.id, nameSnapshot: 'Corrected', specSnapshot: '10mg', qty: 2, unitPricePhp: 400 },
        { nameSnapshot: 'Manual add-on', qty: 1, unitPricePhp: 250 },
      ] }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: order.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.order).toMatchObject({ subtotalPhp: '1050.00', totalPhp: '1200.00' });
  });

  it('locks fulfilled orders', async () => {
    const { order, item } = await seed('shipped');
    const req = new Request(`http://localhost/api/admin/orders/${order.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: item.id, nameSnapshot: 'Changed', qty: 1, unitPricePhp: 500 }] }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: order.id }) });
    expect(res.status).toBe(409);
  });

  it('keeps on-hand inventory in sync with a quantity correction', async () => {
    const db = await getDb();
    const { order, item } = await seed();
    const [product] = await db.insert(products).values({
      name: 'Inventory item', spec: '10mg', pricePhp: '500', stock: 9, soldCount: 1,
    }).returning();
    await db.update(orderItems).set({ productId: product.id, specSnapshot: 'On-hand · per piece' })
      .where(eq(orderItems.id, item.id));

    const req = new Request(`http://localhost/api/admin/orders/${order.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: item.id, nameSnapshot: 'Inventory item', qty: 3, unitPricePhp: 500 }] }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: order.id }) });
    const [after] = await db.select().from(products).where(eq(products.id, product.id));

    expect(res.status).toBe(200);
    expect(after).toMatchObject({ stock: 7, soldCount: 3 });
  });
});
