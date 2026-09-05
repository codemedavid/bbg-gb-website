// The on-hand bulk rate, on the money path.
//
// The shop quotes a discounted per-vial price once a customer takes ten vials or
// more. The storefront shows that rate, so the server has to CHARGE it — a
// checkout that re-prices at the list price would take ₱7,000 for the ₱6,500
// the customer was just congratulated on.
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
const { eq } = await import('drizzle-orm');
const { getDb, orderItems } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

async function itemsOf(orderId: string) {
  const db = await getDb();
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
}

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

// The live shape from the report: ₱700 a vial, ₱6,500 for ten.
const shelf = { onHandPiecePhp: 700, onHandKitPhp: 6500, onHandTenVialPhp: 6500, stock: 100 };

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('POST /api/orders — the on-hand bulk rate', () => {
  it('charges the list price below ten vials', async () => {
    await signIn();
    const product = await makeProduct(shelf);

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 9, unit: 'piece' }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.totals.subtotal).toBe(6300);
  });

  it('charges the bulk rate on every vial at exactly ten', async () => {
    await signIn();
    const product = await makeProduct(shelf);

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 10, unit: 'piece' }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.totals.subtotal).toBe(6500);
    const [line] = await itemsOf(body.data.order.id);
    expect(Number(line.unitPricePhp)).toBe(650);
    expect(Number(line.lineTotalPhp)).toBe(6500);
  });

  it('keeps the bulk rate above ten', async () => {
    await signIn();
    const product = await makeProduct(shelf);

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 23, unit: 'piece' }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.totals.subtotal).toBe(14950);
  });

  it('records the rate on the line, so the order says why it was cheap', async () => {
    await signIn();
    const product = await makeProduct(shelf);

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 12, unit: 'piece' }]));
    const body = await res.json();

    const [line] = await itemsOf(body.data.order.id);
    expect(line.specSnapshot).toContain('10+ vial price');
  });

  it('does not discount a product that states no bulk rate', async () => {
    await signIn();
    const product = await makeProduct({ ...shelf, onHandTenVialPhp: null });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 10, unit: 'piece' }]));
    const body = await res.json();

    expect(body.data.totals.subtotal).toBe(7000);
  });

  it('refuses to treat a rate dearer than the piece price as a discount', async () => {
    await signIn();
    const product = await makeProduct({ ...shelf, onHandTenVialPhp: 9000 });

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 10, unit: 'piece' }]));
    const body = await res.json();

    expect(body.data.totals.subtotal).toBe(7000);
  });

  it('leaves a kit line on the kit price — a kit is not ten discounted pieces', async () => {
    await signIn();
    const product = await makeProduct(shelf);

    const res = await POST(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'kit' }]));
    const body = await res.json();

    expect(body.data.totals.subtotal).toBe(6500);
    const [line] = await itemsOf(body.data.order.id);
    expect(line.specSnapshot).not.toContain('10+ vial price');
  });
});
