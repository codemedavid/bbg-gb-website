// Editing an MOQ line moves the shelf counter.
//
// The shelf holds nothing, so unlike an on-hand edit there is no ceiling to bump
// into — the counter simply follows the quantity. What it must NOT do is follow
// it into the wrong round: once a round is closed its units went to the
// supplier, and correcting one of those orders afterwards must leave the round
// now filling untouched.
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

const { POST: CHECKOUT } = await import('@/app/api/orders/route');
const { getDb, moqProducts, orderItems } = await import('@/lib/db');
const { applyOrderItemEdit } = await import('@/lib/order-edit-server');
const { resetDb, makeUser, makeMoqProduct, checkoutRequest } = await import('@/lib/test/harness');

const committedOf = async (id: string): Promise<number> => {
  const [row] = await (await getDb()).select().from(moqProducts).where(eq(moqProducts.id, id));
  return row.committed;
};

// A real MOQ order, placed the way a customer places one — so the line carries
// the cycle number checkout actually stamped on it.
async function buy(productId: string, qty: number) {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: 'customer', email: user.email };
  const body = await (await CHECKOUT(checkoutRequest([{ kind: 'moq_product', refId: productId, qty }]))).json();
  const orderId = body.data.order.id as string;
  const db = await getDb();
  const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return { orderId, lineId: line.id };
}

// `items` is the complete intended line set, so the edit restates the line it
// keeps — name and price unchanged, only the quantity corrected.
const edit = async (orderId: string, lineId: string, qty: number) => {
  const db = await getDb();
  await db.transaction((tx) => applyOrderItemEdit(tx, orderId, [{
    id: lineId, qty, nameSnapshot: 'Test MOQ Product 1500mg', unitPricePhp: 4500,
  }]));
};

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('editing an MOQ line', () => {
  it('follows a quantity increase up the counter', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const { orderId, lineId } = await buy(p.id, 50);

    await edit(orderId, lineId, 80);

    expect(await committedOf(p.id)).toBe(80);
  });

  it('follows a quantity decrease back down', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const { orderId, lineId } = await buy(p.id, 50);

    await edit(orderId, lineId, 20);

    expect(await committedOf(p.id)).toBe(20);
  });

  it('accepts an increase far beyond the target — there is no ceiling', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const { orderId, lineId } = await buy(p.id, 10);

    await edit(orderId, lineId, 900);

    expect(await committedOf(p.id)).toBe(900);
  });

  // The bug this pins: a correction to a closed round's order was debiting the
  // round now filling, erasing demand that belonged to its buyers.
  it('leaves the current round alone when editing an order from a closed one', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const { orderId, lineId } = await buy(p.id, 200);

    // The admin closed round 1; round 2 has been filling since.
    const db = await getDb();
    await db.update(moqProducts).set({ cycleNo: 2, committed: 300 }).where(eq(moqProducts.id, p.id));

    await edit(orderId, lineId, 150);

    expect(await committedOf(p.id)).toBe(300);
  });

  it('never drives the counter negative', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 0 });
    const { orderId, lineId } = await buy(p.id, 50);

    const db = await getDb();
    await db.update(moqProducts).set({ committed: 5 }).where(eq(moqProducts.id, p.id));

    await edit(orderId, lineId, 1);

    expect(await committedOf(p.id)).toBe(0);
  });
});
