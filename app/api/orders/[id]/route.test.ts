// The order details endpoint — everything one order is, in one response.
//
// The brief's requirement is that a customer can see a complete order without
// walking several screens, and specifically that a LARGE order stays complete.
// So the load-bearing test here places a realistic many-product, many-variant
// order and asserts every line survives the round trip with the right quantity
// and the right price. A details page cannot show what the API drops.
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

const { GET } = await import('./route');
const { POST } = await import('../route');
const { resetDb, openBoards, makeUser, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

const detail = async (id: string) => {
  const res = await GET(new Request(`http://t/api/orders/${id}`), { params: Promise.resolve({ id }) });
  return { res, body: await res.json() };
};

async function signIn(over: Record<string, unknown> = {}) {
  const user = await makeUser({ role: 'customer', ...over });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

// The order from the brief: four peptides, two of them the same product at
// different strengths, quantities that are not all 1.
const CART = [
  { name: 'Tirzepatide', spec: '15mg vial', price: 3200, qty: 1 },
  { name: 'Tirzepatide', spec: '30mg vial', price: 4850, qty: 1 },
  { name: 'Retatrutide', spec: '20mg vial', price: 6875, qty: 2 },
  { name: 'Cagrilintide', spec: '5mg vial', price: 4050, qty: 3 },
  { name: 'BPC157', spec: '10mg vial', price: 3750, qty: 1 },
  { name: 'TB500', spec: '10mg vial', price: 7500, qty: 2 },
  { name: 'MOTS-C', spec: '10mg vial', price: 3750, qty: 1 },
  { name: 'GHK-Cu', spec: '50mg vial', price: 2200, qty: 4 },
  { name: 'KPV', spec: '10mg vial', price: 3300, qty: 1 },
  { name: 'SS31', spec: '10mg vial', price: 4250, qty: 2 },
  { name: 'Tesamorelin', spec: '5mg vial', price: 4875, qty: 1 },
  { name: 'AHK-Cu', spec: '100mg vial', price: 3625, qty: 1 },
];

async function placeBigOrder() {
  const products = [];
  for (const line of CART) {
    products.push({
      line,
      row: await makeProduct({ name: line.name, spec: line.spec, onHandPiecePhp: line.price, stock: 100 }),
    });
  }
  const res = await POST(checkoutRequest(
    products.map(({ line, row }) => ({ kind: 'product', refId: row.id, qty: line.qty, unit: 'piece' })),
  ));
  const body = await res.json();
  expect(res.status, body.error ?? '').toBe(201);
  return body.data.orders[0].order;
}

describe('GET /api/orders/[id] with a large order', () => {
  it('returns every line of a twelve-product order', async () => {
    await signIn();
    const order = await placeBigOrder();

    const { res, body } = await detail(order.id);

    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(CART.length);
  });

  it("keeps each line's quantity and unit price intact", async () => {
    await signIn();
    const order = await placeBigOrder();

    const { body } = await detail(order.id);
    // Checkout snapshots the variant INTO the name ("Tirzepatide 15mg vial")
    // and uses specSnapshot for the buying mode ("On-hand · per piece") — see
    // app/api/orders/route.ts. The variant is therefore identified by name.
    const byVariant = new Map(
      body.data.items.map((i: { nameSnapshot: string }) => [i.nameSnapshot, i]),
    );

    for (const line of CART) {
      const got = byVariant.get(`${line.name} ${line.spec}`);
      expect(got, `missing ${line.name} ${line.spec}`).toBeTruthy();
      expect(got.qty).toBe(line.qty);
      expect(Number(got.unitPricePhp)).toBe(line.price);
      expect(Number(got.lineTotalPhp)).toBe(line.price * line.qty);
    }
  });

  // Two strengths of one peptide are two different things the customer paid
  // two different prices for. Collapsing them loses a line of the order.
  it('keeps two variants of the same peptide apart', async () => {
    await signIn();
    const order = await placeBigOrder();

    const { body } = await detail(order.id);
    const tirz = body.data.items
      .filter((i: { nameSnapshot: string }) => i.nameSnapshot.startsWith('Tirzepatide'))
      .map((i: { nameSnapshot: string }) => i.nameSnapshot)
      .sort();

    expect(tirz).toEqual(['Tirzepatide 15mg vial', 'Tirzepatide 30mg vial']);
  });

  it('adds up to the order total it was charged', async () => {
    await signIn();
    const order = await placeBigOrder();

    const { body } = await detail(order.id);
    const lines = body.data.items.reduce((sum: number, i: { lineTotalPhp: string }) => sum + Number(i.lineTotalPhp), 0);

    expect(lines).toBe(Number(body.data.order.subtotalPhp));
  });
});

// The details page shows Customer Information. The email is on the user record,
// not the order, so the endpoint has to carry it or the page has nothing to
// render.
describe('the customer block', () => {
  it('carries the contact details the order was placed with', async () => {
    const user = await signIn({ name: 'Ana Cruz' });
    const order = await placeBigOrder();

    const { body } = await detail(order.id);

    expect(body.data.customer.email).toBe(user.email);
    expect(body.data.customer.name).toBe('Ana Cruz');
    // Shipping is read off the order's own snapshot, never the live user
    // record: an address edited later must not rewrite where a packed parcel
    // was actually sent.
    expect(body.data.order.shipAddress).toBe('123 Mabini St, Manila');
  });
});

describe('access control', () => {
  it("refuses to show one customer another customer's order", async () => {
    await signIn();
    const order = await placeBigOrder();

    const intruder = await makeUser({ role: 'customer' });
    session.current = { sub: intruder.id, role: intruder.role, email: intruder.email };

    const { res } = await detail(order.id);
    expect(res.status).toBe(403);
  });

  it('requires a session at all', async () => {
    await signIn();
    const order = await placeBigOrder();
    session.current = null;

    const { res } = await detail(order.id);
    expect(res.status).toBe(401);
  });
});
