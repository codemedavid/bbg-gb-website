// Cart packing-fee resolution and post-checkout clearing.
//
// The packing fee shown in the cart must track the admin's saved settings for
// EVERY mode. It previously only threaded through the on-hand fee, so editing the
// Hatian packing fee in the admin panel left the cart quoting the code constant.
import { describe, it, expect, beforeEach } from 'vitest';
import { useCart, packingFeeFor, maxQtyFor, type CartItem } from './cart';
import { PACKING_FEE_PHP } from '@/lib/pricing';

const onHand = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
  spec: '10mg', unitPricePhp: 550, qty: 1, minQty: 1, unit: 'piece', stock: 100, ...o,
});

const kahati = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'gb:g1', kind: 'group_buy', refId: 'g1', name: 'Test Kahati — kahati',
  spec: 'Kahati · min 1 vials', unitPricePhp: 900, qty: 1, minQty: 1, ...o,
});

describe('packingFeeFor', () => {
  it('falls back to the code defaults when no admin fees are supplied', () => {
    expect(packingFeeFor([onHand()])).toBe(PACKING_FEE_PHP.solo);
    expect(packingFeeFor([kahati()])).toBe(PACKING_FEE_PHP.kahati);
  });

  it('uses the admin on-hand fee for an on-hand cart', () => {
    expect(packingFeeFor([onHand()], { solo: 275, kahati: 150, group_buy: 300, moq: 300 })).toBe(275);
  });

  it('uses the admin hatian fee when the listing carries no override', () => {
    // Regression: the kahati leg ignored the admin settings entirely.
    expect(packingFeeFor([kahati()], { solo: 200, kahati: 99, group_buy: 300, moq: 300 })).toBe(99);
  });

  it('lets a per-listing kahati fee override the admin default', () => {
    expect(packingFeeFor([kahati({ packingFeePhp: 180 })], { solo: 200, kahati: 99, group_buy: 300, moq: 300 })).toBe(180);
  });

  it('charges one fee per mode present in a mixed cart', () => {
    const fees = { solo: 200, kahati: 150, group_buy: 300, moq: 300 };
    expect(packingFeeFor([onHand(), kahati()], fees)).toBe(350);
  });

  it('sums a fee per kahati placement — different peps each pay their own', () => {
    const items = [kahati({ key: 'gb:a', packingFeePhp: 120 }), kahati({ key: 'gb:b', packingFeePhp: 210 })];
    expect(packingFeeFor(items, { solo: 200, kahati: 150, group_buy: 300, moq: 300 })).toBe(330);
  });

  it('charges nothing for an empty cart', () => {
    expect(packingFeeFor([])).toBe(0);
  });
});

describe('cart clearing after checkout', () => {
  beforeEach(() => useCart.getState().clear());

  it('removes every checked-out line so the cart is empty on return', () => {
    const { add } = useCart.getState();
    add(onHand());
    add(kahati());
    expect(useCart.getState().items).toHaveLength(2);

    useCart.getState().clear();

    expect(useCart.getState().items).toEqual([]);
    expect(useCart.getState().count()).toBe(0);
    expect(useCart.getState().subtotal()).toBe(0);
  });

  it('leaves no persisted lines behind for the next page load', () => {
    useCart.getState().add(onHand());
    useCart.getState().clear();
    // Whatever the persist middleware wrote must not resurrect the cart.
    const persisted = globalThis.localStorage?.getItem('bbg-cart');
    if (persisted) expect(JSON.parse(persisted).state.items).toEqual([]);
    expect(useCart.getState().items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MOQ lines in the cart.
//
// An MOQ product carries an admin-set minimum order quantity. The cart must
// respect it the same way it respects a kahati minimum — decrementing past the
// minimum removes the line rather than dropping below a quantity checkout would
// reject — and MOQ must add its own packing fee leg.
// ---------------------------------------------------------------------------
const moqItem = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'moq:m1', kind: 'moq_product', refId: 'm1', name: 'FUAN GTT1500',
  spec: 'MOQ · min 5', unitPricePhp: 4500, qty: 5, minQty: 5, stock: 50, ...o,
});

describe('MOQ cart lines', () => {
  beforeEach(() => useCart.getState().clear());

  it('charges the admin MOQ packing fee for an MOQ-only cart', () => {
    expect(packingFeeFor([moqItem()], { solo: 200, kahati: 150, group_buy: 300, moq: 275 })).toBe(275);
  });

  it('lets a per-listing MOQ fee override the admin default', () => {
    expect(packingFeeFor([moqItem({ packingFeePhp: 450 })], { solo: 200, kahati: 150, group_buy: 300, moq: 275 })).toBe(450);
  });

  it('adds an MOQ fee leg on top of the on-hand fee in a mixed cart', () => {
    const fees = { solo: 200, kahati: 150, group_buy: 300, moq: 300 };
    expect(packingFeeFor([onHand(), moqItem()], fees)).toBe(500);
  });

  it('falls back to the code default when no admin fees are supplied', () => {
    expect(packingFeeFor([moqItem()])).toBe(PACKING_FEE_PHP.moq);
  });

  it('removes the line rather than dropping below the minimum order quantity', () => {
    useCart.getState().add(moqItem());
    useCart.getState().dec('moq:m1');
    expect(useCart.getState().items).toHaveLength(0);
  });

  it('clamps an MOQ line to the stock on hand', () => {
    useCart.getState().add(moqItem({ qty: 5, stock: 8 }));
    useCart.getState().setQty('moq:m1', 99);
    expect(useCart.getState().items[0].qty).toBe(8);
  });

  it('counts MOQ units toward the cart badge and subtotal', () => {
    useCart.getState().add(moqItem({ qty: 5 }));
    expect(useCart.getState().count()).toBe(5);
    expect(useCart.getState().subtotal()).toBe(22500);
  });
});

// ---------------------------------------------------------------------------
// Kahati lines and the hatian's remaining vials.
//
// A kahati line's ceiling is the hatian's remaining open vials, passed in as
// `stock` when the customer joins. Without it the cart treated kahati lines as
// uncapped, so repeated Join taps accumulated a quantity checkout would reject.
// ---------------------------------------------------------------------------
describe('kahati lines clamp to the hatian’s remaining vials', () => {
  beforeEach(() => useCart.getState().clear());

  it('caps a kahati line at the remaining vials when they are known', () => {
    expect(maxQtyFor(kahati({ stock: 4 }))).toBe(4);
  });

  it('keeps a kahati line without a known remainder uncapped (server is the gate)', () => {
    expect(maxQtyFor(kahati())).toBe(Infinity);
  });

  it('clamps repeated Join taps to the remaining vials instead of accumulating', () => {
    useCart.getState().add(kahati({ stock: 5, qty: 3 }));
    useCart.getState().add(kahati({ stock: 5, qty: 3 }));

    expect(useCart.getState().items[0].qty).toBe(5);
  });

  it('clamps a manual quantity edit the same way', () => {
    useCart.getState().add(kahati({ stock: 6, qty: 2 }));
    useCart.getState().setQty('gb:g1', 99);

    expect(useCart.getState().items[0].qty).toBe(6);
  });
});
