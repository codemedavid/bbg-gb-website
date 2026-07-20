// The cart -> checkout contract.
//
// app/checkout/page.tsx forwards each cart line to POST /api/orders verbatim:
//
//     items.map((i) => ({ kind: i.kind, refId: i.refId, qty: i.qty, unit: i.unit }))
//
// So every value CartItem['kind'] can hold must be a value the orders route
// accepts. Nothing enforced that. The MOQ work stored 'moq' in the cart while
// the route accepted 'moq_product', and both sides were tested in isolation —
// cart tests spoke the cart's vocabulary, route tests spoke the route's — so a
// checkout that fails for every real customer passed both suites.
//
// These tests cross the seam on purpose: they put items in the real cart store,
// serialize them exactly as the checkout page does, and post them to the real
// route handler.
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
const { useCart } = await import('@/lib/store/cart');
type CartKind = Parameters<ReturnType<typeof useCart.getState>['add']>[0]['kind'];
const { resetDb, makeUser, makeProduct, makeGroupBuy, makeMoqProduct, SHIPPING } = await import('@/lib/test/harness');

// Byte-for-byte what app/checkout/page.tsx builds and sends.
function checkoutRequestFromCart(): Request {
  const items = useCart.getState().items;
  const form = new FormData();
  form.set('items', JSON.stringify(items.map((i) => ({ kind: i.kind, refId: i.refId, qty: i.qty, unit: i.unit }))));
  form.set('shipName', SHIPPING.shipName);
  form.set('shipPhone', SHIPPING.shipPhone);
  form.set('shipAddress', SHIPPING.shipAddress);
  form.set('proof', new File([Buffer.from('fake-proof-image')], 'proof.png', { type: 'image/png' }));
  return new Request('http://localhost/api/orders', { method: 'POST', body: form });
}

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

beforeEach(async () => {
  session.current = null;
  useCart.getState().clear();
  await resetDb();
});

describe('every cart line kind is accepted by checkout', () => {
  it('checks out an MOQ line added the way the MOQ board adds it', async () => {
    await signIn();
    const p = await makeMoqProduct({ pricePhp: 4500, stock: 50, minOrderQty: 5 });

    // Exactly the shape MoqBoard.handleAdd pushes into the cart.
    useCart.getState().add({
      key: `moq:${p.id}`, kind: 'moq' as CartKind, refId: p.id,
      name: p.name, spec: 'MOQ · min 5',
      unitPricePhp: 4500, minQty: 5, qty: 5, stock: 50,
    });

    const res = await POST(checkoutRequestFromCart());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.order.buyType).toBe('moq');
  });

  it('checks out an on-hand line added the way a product card adds it', async () => {
    await signIn();
    const p = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    useCart.getState().add({
      key: `product:${p.id}:piece`, kind: 'product', refId: p.id,
      name: 'Test Peptide', spec: '10mg',
      unitPricePhp: 550, minQty: 1, qty: 2, unit: 'piece', stock: 50,
    });

    expect((await POST(checkoutRequestFromCart())).status).toBe(201);
  });

  it('checks out a kahati line added the way the join sheet adds it', async () => {
    await signIn();
    const g = await makeGroupBuy({ pricePerKitPhp: 9000, minVials: 1 });

    useCart.getState().add({
      key: `gb:${g.id}`, kind: 'group_buy', refId: g.id,
      name: 'Test Kahati — kahati', spec: 'Kahati · min 1 vials',
      unitPricePhp: 900, minQty: 1, qty: 1, packingFeePhp: 150,
    });

    expect((await POST(checkoutRequestFromCart())).status).toBe(201);
  });

  it('checks out a mixed cart, splitting it into one order per mode', async () => {
    await signIn();
    const onHand = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    const moq = await makeMoqProduct({ pricePhp: 4500, stock: 50, minOrderQty: 1 });

    useCart.getState().add({
      key: `product:${onHand.id}:piece`, kind: 'product', refId: onHand.id,
      name: 'Test Peptide', spec: '10mg', unitPricePhp: 550, minQty: 1, qty: 1, unit: 'piece', stock: 50,
    });
    useCart.getState().add({
      key: `moq:${moq.id}`, kind: 'moq' as CartKind, refId: moq.id,
      name: moq.name, spec: 'MOQ · min 1', unitPricePhp: 4500, minQty: 1, qty: 2, stock: 50,
    });

    const body = await (await POST(checkoutRequestFromCart())).json();

    expect(body.data.orders).toHaveLength(2);
    expect(body.data.orders.map((o: { order: { buyType: string } }) => o.order.buyType).sort())
      .toEqual(['moq', 'solo']);
  });
});
