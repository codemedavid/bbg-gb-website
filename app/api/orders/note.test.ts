// The customer's order note, and the per-system order reference.
//
// Two things a customer needs the order record to carry that it did not: the
// instructions they typed in the cart, and a reference that says which system
// the order belongs to. Group Buy and Kahati are separate systems with separate
// lifecycles; a shared BBG-#### series made a Kahati commitment and a Group Buy
// commitment indistinguishable at a glance.
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
const {
  resetDb, openBoards, makeUser, makeProduct, makeGroupBuy, makeMoqCampaign, makeMoqProduct, checkoutRequest,
} = await import('@/lib/test/harness');

type CreatedOrder = { order: { notes: string | null; orderNo: string; buyType: string }; orderNo: string };

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const place = async (items: unknown, opts: Parameters<typeof checkoutRequest>[1] = {}) => {
  const res = await POST(checkoutRequest(items, opts));
  const body = await res.json();
  return { res, body, orders: (body.data?.orders ?? []) as CreatedOrder[] };
};

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('order note', () => {
  it('saves the note the customer typed in the cart', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const { res, orders } = await place(
      [{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }],
      { note: 'Please text before delivery — gate closes at 8pm.' },
    );

    expect(res.status).toBe(201);
    expect(orders[0].order.notes).toBe('Please text before delivery — gate closes at 8pm.');
  });

  it('writes the note onto every order a mixed cart splits into', async () => {
    // One note, one checkout. A customer who asked for careful packing did not
    // mean "only for the on-hand parcel".
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const gb = await makeGroupBuy({ minVials: 1 });

    const { orders } = await place([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
      { kind: 'group_buy', refId: gb.id, qty: 1 },
    ], { note: 'Bubble wrap please.' });

    expect(orders).toHaveLength(2);
    expect(orders.every((o) => o.order.notes === 'Bubble wrap please.')).toBe(true);
  });

  it('stores nothing when no note was written', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const { orders } = await place([{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }]);

    expect(orders[0].order.notes).toBeNull();
  });

  it('treats a whitespace-only note as no note', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const { orders } = await place(
      [{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }],
      { note: '   ' },
    );

    expect(orders[0].order.notes).toBeNull();
  });

  it('rejects a note longer than the column holds instead of truncating it silently', async () => {
    // Truncation would store instructions that read as complete but are not —
    // worse than refusing, because nobody can tell the difference afterwards.
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const { res } = await place(
      [{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }],
      { note: 'x'.repeat(501) },
    );

    expect(res.status).toBe(400);
  });

  it('does not change what the customer is charged', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const plain = await place([{ kind: 'product', refId: product.id, qty: 2, unit: 'piece' }]);
    await resetDb();
    await openBoards();
    await signIn();
    const noted = await place(
      [{ kind: 'product', refId: (await makeProduct({ onHandPiecePhp: 550, stock: 50 })).id, qty: 2, unit: 'piece' }],
      { note: 'Handle with care' },
    );

    expect(noted.body.data.totals).toEqual(plain.body.data.totals);
  });
});

describe('per-system order references', () => {
  it('gives a Kahati order a KH- reference', async () => {
    await signIn();
    const gb = await makeGroupBuy({ minVials: 1 });

    const { orders } = await place([{ kind: 'group_buy', refId: gb.id, qty: 1 }]);

    expect(orders[0].order.buyType).toBe('kahati');
    expect(orders[0].orderNo).toMatch(/^KH-\d+$/);
  });

  it('gives a Group Buy order a GB- reference', async () => {
    await signIn();
    const campaign = await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });

    const { orders } = await place([{ kind: 'moq_campaign', refId: campaign.id, qty: 1 }]);

    expect(orders[0].order.buyType).toBe('group_buy');
    expect(orders[0].orderNo).toMatch(/^GB-\d+$/);
  });

  it('leaves on-hand orders on the existing BBG- series', async () => {
    await signIn();
    const product = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const { orders } = await place([{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }]);

    expect(orders[0].orderNo).toMatch(/^BBG-\d+$/);
  });

  it('leaves MOQ shelf orders on the BBG- series', async () => {
    await signIn();
    const m = await makeMoqProduct({ pricePhp: 300, moq: 500 });

    const { orders } = await place([{ kind: 'moq_product', refId: m.id, qty: 1 }]);

    expect(orders[0].orderNo).toMatch(/^BBG-\d+$/);
  });

  it('never issues one reference covering both systems', async () => {
    // The whole point: a cart holding both produces two orders, and the
    // references say which is which without anyone having to look them up.
    await signIn();
    const gb = await makeGroupBuy({ minVials: 1 });
    const campaign = await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });

    const { orders } = await place([
      { kind: 'group_buy', refId: gb.id, qty: 1 },
      { kind: 'moq_campaign', refId: campaign.id, qty: 1 },
    ]);

    const byType = Object.fromEntries(orders.map((o) => [o.order.buyType, o.orderNo]));
    expect(byType.kahati).toMatch(/^KH-/);
    expect(byType.group_buy).toMatch(/^GB-/);
    expect(byType.kahati).not.toBe(byType.group_buy);
  });

  it('draws every reference from one sequence, so no two orders can collide', async () => {
    // The prefix is presentation; uniqueness still comes from the shared
    // sequence. Two systems each counting from 1 would produce KH-1 and GB-1
    // today and a duplicate the moment anything joins them up.
    await signIn();
    const gb = await makeGroupBuy({ minVials: 1 });
    const campaign = await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });

    const { orders } = await place([
      { kind: 'group_buy', refId: gb.id, qty: 1 },
      { kind: 'moq_campaign', refId: campaign.id, qty: 1 },
    ]);

    const numbers = orders.map((o) => Number(o.orderNo.split('-')[1]));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
