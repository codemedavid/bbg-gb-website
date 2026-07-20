// Checkout for the MOQ shelf.
//
// MOQ is the fourth purchase mode, so an MOQ line must reach checkout as its own
// order with its own packing fee — never folded into the on-hand, hatian or
// pasabay order. Stock is drawn down under the same guarded UPDATE the shop uses
// so two concurrent checkouts cannot oversell, and the per-product minimum order
// quantity is re-checked server-side because the client is never trusted.
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

const { POST } = await import('./route');
const { resetDb, makeUser, makeProduct, makeMoqProduct, checkoutRequest } = await import('@/lib/test/harness');
const { getDb, moqProducts, orderItems } = await import('@/lib/db');
const { PACKING_FEE_PHP } = await import('@/lib/pricing');
const { eq } = await import('drizzle-orm');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('MOQ checkout', () => {
  it('creates an order with buyType "moq" and the MOQ packing fee', async () => {
    await signIn();
    const p = await makeMoqProduct({ pricePhp: 4500, stock: 50, minOrderQty: 5 });

    const res = await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 5 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.orders).toHaveLength(1);
    expect(body.data.order.buyType).toBe('moq');
    expect(Number(body.data.order.subtotalPhp)).toBe(22500);
    expect(Number(body.data.order.packingFeePhp)).toBe(PACKING_FEE_PHP.moq);
    expect(Number(body.data.order.totalPhp)).toBe(22500 + PACKING_FEE_PHP.moq);
  });

  it('records the line against the MOQ product with a name snapshot', async () => {
    await signIn();
    const p = await makeMoqProduct({ name: 'FUAN GTT1500', pricePhp: 4500, stock: 50 });

    const body = await (await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 2 }]))).json();

    const db = await getDb();
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, body.data.order.id));
    expect(line.kind).toBe('moq_product');
    expect(line.moqProductId).toBe(p.id);
    expect(line.nameSnapshot).toContain('FUAN GTT1500');
    expect(line.qty).toBe(2);
  });

  it('draws the purchased quantity out of stock', async () => {
    await signIn();
    const p = await makeMoqProduct({ stock: 50, minOrderQty: 1 });

    await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 8 }]));

    const db = await getDb();
    const [row] = await db.select().from(moqProducts).where(eq(moqProducts.id, p.id));
    expect(row.stock).toBe(42);
  });

  it('prices server-side and ignores any price the client sends', async () => {
    await signIn();
    const p = await makeMoqProduct({ pricePhp: 4500, stock: 50, minOrderQty: 1 });

    const body = await (await POST(checkoutRequest([
      { kind: 'moq_product', refId: p.id, qty: 1, unitPricePhp: 1 },
    ]))).json();

    expect(Number(body.data.order.subtotalPhp)).toBe(4500);
  });

  it('honours a per-listing packing fee over the global MOQ default', async () => {
    await signIn();
    const p = await makeMoqProduct({ pricePhp: 4500, stock: 50, packingFeePhp: 450 });

    const body = await (await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 1 }]))).json();
    expect(Number(body.data.order.packingFeePhp)).toBe(450);
  });

  it('rejects a quantity below the product minimum order quantity', async () => {
    await signIn();
    const p = await makeMoqProduct({ stock: 50, minOrderQty: 5 });

    const res = await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 4 }]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('5');
  });

  it('rejects a quantity beyond available stock', async () => {
    await signIn();
    const p = await makeMoqProduct({ stock: 3, minOrderQty: 1 });

    const res = await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 10 }]));
    expect(res.status).toBe(400);
  });

  it('leaves stock untouched when the order is rejected', async () => {
    await signIn();
    const p = await makeMoqProduct({ stock: 3, minOrderQty: 1 });

    await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 10 }]));

    const db = await getDb();
    const [row] = await db.select().from(moqProducts).where(eq(moqProducts.id, p.id));
    expect(row.stock).toBe(3);
  });

  it('refuses to sell an archived MOQ product', async () => {
    await signIn();
    const p = await makeMoqProduct({ stock: 50, isActive: false });

    const res = await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 1 }]));
    expect(res.status).toBe(400);
  });

  it('refuses an unknown MOQ product id', async () => {
    await signIn();
    const res = await POST(checkoutRequest([
      { kind: 'moq_product', refId: '11111111-1111-1111-1111-111111111111', qty: 1 },
    ]));
    expect(res.status).toBe(400);
  });

  it('requires a signed-in customer', async () => {
    const p = await makeMoqProduct();
    const res = await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 1 }]));
    expect(res.status).toBe(401);
  });
});

describe('MOQ never shares an order with another mode', () => {
  it('splits an on-hand + MOQ cart into two orders with their own packing fees', async () => {
    await signIn();
    const onHand = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const moq = await makeMoqProduct({ pricePhp: 4500, stock: 50, minOrderQty: 1 });

    const body = await (await POST(checkoutRequest([
      { kind: 'product', refId: onHand.id, qty: 2, unit: 'piece' },
      { kind: 'moq_product', refId: moq.id, qty: 3 },
    ]))).json();

    expect(body.data.orders).toHaveLength(2);

    const orders = body.data.orders.map((o: { order: Record<string, string> }) => o.order);
    const solo = orders.find((o: { buyType: string }) => o.buyType === 'solo');
    const moqOrder = orders.find((o: { buyType: string }) => o.buyType === 'moq');

    expect(Number(solo.packingFeePhp)).toBe(PACKING_FEE_PHP.solo);
    expect(Number(solo.totalPhp)).toBe(1100 + PACKING_FEE_PHP.solo);

    expect(Number(moqOrder.packingFeePhp)).toBe(PACKING_FEE_PHP.moq);
    expect(Number(moqOrder.totalPhp)).toBe(13500 + PACKING_FEE_PHP.moq);
  });

  it('gives each split order its own order number', async () => {
    await signIn();
    const onHand = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const moq = await makeMoqProduct({ pricePhp: 4500, stock: 50, minOrderQty: 1 });

    const body = await (await POST(checkoutRequest([
      { kind: 'product', refId: onHand.id, qty: 1, unit: 'piece' },
      { kind: 'moq_product', refId: moq.id, qty: 1 },
    ]))).json();

    const nos = body.data.orders.map((o: { orderNo: string }) => o.orderNo);
    expect(new Set(nos).size).toBe(2);
  });

  it('charges no downpayment on an MOQ order — it is paid in full', async () => {
    await signIn();
    const p = await makeMoqProduct({ pricePhp: 4500, stock: 50, minOrderQty: 1 });

    const body = await (await POST(checkoutRequest([{ kind: 'moq_product', refId: p.id, qty: 1 }]))).json();
    expect(Number(body.data.order.downpaymentPhp)).toBe(0);
  });
});
