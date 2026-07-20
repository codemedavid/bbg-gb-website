// Cart packing-fee resolution and post-checkout clearing.
//
// The packing fee shown in the cart must track the admin's saved settings for
// EVERY mode. It previously only threaded through the on-hand fee, so editing the
// Hatian packing fee in the admin panel left the cart quoting the code constant.
import { describe, it, expect, beforeEach } from 'vitest';
import { useCart, packingFeeFor, type CartItem } from './cart';
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

  it('takes the highest fee among several kahati listings', () => {
    const items = [kahati({ key: 'gb:a', packingFeePhp: 120 }), kahati({ key: 'gb:b', packingFeePhp: 210 })];
    expect(packingFeeFor(items, { solo: 200, kahati: 150, group_buy: 300, moq: 300 })).toBe(210);
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
