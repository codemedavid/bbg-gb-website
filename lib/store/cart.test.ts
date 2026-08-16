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

const campaign = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'gbuy:c1', kind: 'moq_campaign', refId: 'c1', name: 'Reta 20mg — group buy',
  spec: 'Group buy · batch #1', unitPricePhp: 10000, qty: 1, minQty: 1, packingFeePhp: 300, ...o,
});

describe('packingFeeFor', () => {
  it('falls back to the code defaults when no admin fees are supplied', () => {
    expect(packingFeeFor([onHand()])).toBe(PACKING_FEE_PHP.solo);
  });

  it('uses the admin on-hand fee for an on-hand cart', () => {
    expect(packingFeeFor([onHand()], { solo: 275, kahati: 150, group_buy: 300, moq: 300 })).toBe(275);
  });

  it('charges the hatian fee at checkout, not at settlement', () => {
    // The ₱150 is what the customer pays today, added to the goods rather than
    // taken out of them.
    expect(packingFeeFor([kahati()])).toBe(150);
    expect(packingFeeFor([kahati()], { solo: 200, kahati: 99, group_buy: 300, moq: 300 })).toBe(99);
  });

  it('lets a per-listing kahati fee win over the admin default', () => {
    expect(packingFeeFor([kahati({ packingFeePhp: 180 })], { solo: 200, kahati: 99, group_buy: 300, moq: 300 })).toBe(180);
  });

  it('charges the on-hand parcel and the cycle separately in a mixed cart', () => {
    const fees = { solo: 200, kahati: 150, group_buy: 300, moq: 300 };
    // Two parcels on two timings: the on-hand one ships now, the hatian one
    // when the cycle's goods arrive.
    expect(packingFeeFor([onHand(), kahati()], fees)).toBe(350);
  });

  it('charges one fee for two hatian placements — one cycle, one parcel', () => {
    const items = [kahati({ key: 'gb:a', packingFeePhp: 120 }), kahati({ key: 'gb:b', packingFeePhp: 210 })];
    expect(packingFeeFor(items, { solo: 200, kahati: 150, group_buy: 300, moq: 300 })).toBe(210);
  });

  it('charges nothing for an empty cart', () => {
    expect(packingFeeFor([])).toBe(0);
  });

  it('charges one group buy fee however many group buys are in the cart', () => {
    // "Packing fee per checkout, hindi per product" applied to the group buy
    // board: three campaigns bought together ship as one parcel.
    const items = [
      campaign({ key: 'gbuy:a', refId: 'a' }),
      campaign({ key: 'gbuy:b', refId: 'b' }),
      campaign({ key: 'gbuy:c', refId: 'c' }),
    ];
    expect(packingFeeFor(items)).toBe(300);
  });

  it('charges the largest per-campaign fee when they differ', () => {
    const items = [
      campaign({ key: 'gbuy:a', refId: 'a', packingFeePhp: 250 }),
      campaign({ key: 'gbuy:b', refId: 'b', packingFeePhp: 400 }),
    ];
    expect(packingFeeFor(items)).toBe(400);
  });

  it('falls back to the admin group buy fee when a campaign carries none', () => {
    const fees = { solo: 200, kahati: 150, group_buy: 350, moq: 300 };
    expect(packingFeeFor([campaign({ packingFeePhp: undefined })], fees)).toBe(350);
  });

  it('adds one fee per mode when a group buy shares the cart with on-hand stock', () => {
    // Different modes ship as different parcels and check out as different
    // orders, so each carries its own fee.
    const fees = { solo: 200, kahati: 150, group_buy: 300, moq: 300 };
    expect(packingFeeFor([campaign(), onHand()], fees)).toBe(500);
  });

  it('charges no group buy fee for a line whose fee is already paid', () => {
    // A repeat order in a group buy the customer already has an order in joins
    // the parcel they already paid to have packed.
    expect(packingFeeFor([campaign({ packingFeePhp: 0 })])).toBe(0);
  });

  // The client half of the client/server fee agreement: the cart must show ₱0
  // exactly where the server will charge ₱0, and nowhere else.
  it('waives the fee once this cycle is already paid for', () => {
    expect(packingFeeFor([campaign()], PACKING_FEE_PHP, true)).toBe(0);
  });

  it('charges the fee when this cycle has not been paid for', () => {
    expect(packingFeeFor([campaign()], PACKING_FEE_PHP, false)).toBe(300);
  });

  it('charges ONE fee for a cart spanning both boards', () => {
    // Group Buy and Hatian trade in the same cycle and ship one parcel, so a
    // cart holding both pays to have it packed once — the dearer of the two.
    const items = [campaign({ packingFeePhp: 300 }), kahati({ packingFeePhp: 150 })];
    expect(packingFeeFor(items, PACKING_FEE_PHP, false)).toBe(300);
  });

  it('still adds the on-hand fee alongside the one cycle fee', () => {
    // On-hand stock ships as its own parcel on its own timing, so its fee is
    // not the cycle's to waive.
    const fees = { solo: 200, kahati: 150, group_buy: 300, moq: 300 };
    expect(packingFeeFor([campaign(), kahati(), onHand()], fees, false)).toBe(500);
    expect(packingFeeFor([campaign(), kahati(), onHand()], fees, true)).toBe(200);
  });
});

describe('group buy cart lines are uncapped', () => {
  // A commitment beyond the batch's room seals it and rolls into the successor
  // the fill opens, so there is no ceiling for the cart to clamp to.
  it('places no limit on a campaign line', () => {
    expect(maxQtyFor(campaign())).toBe(Infinity);
  });

  it('ignores a stale stock figure persisted on a campaign line', () => {
    expect(maxQtyFor(campaign({ stock: 4 }))).toBe(Infinity);
  });
});

describe('kahati cart lines are uncapped', () => {
  beforeEach(() => useCart.getState().clear());

  // Vials are not drawn from a shelf: checkout fills counters of 10 and opens a
  // fresh one for whatever is left, so a kahati line has no ceiling to clamp to.
  it('places no limit on a kahati line', () => {
    expect(maxQtyFor(kahati())).toBe(Infinity);
  });

  it('ignores a stale kit cap left in a cart persisted before the multi-kit rule', () => {
    // localStorage outlives a deploy. A line saved when the cart still carried
    // `stock: 10` must not keep clamping the customer to a single kit.
    expect(maxQtyFor(kahati({ stock: 10 }))).toBe(Infinity);

    useCart.getState().add(kahati({ stock: 10, qty: 25 }));
    expect(useCart.getState().items[0].qty).toBe(25);
  });

  it('still holds a kahati line at its per-person minimum', () => {
    useCart.getState().add(kahati({ minQty: 3, qty: 1 }));
    expect(useCart.getState().items[0].qty).toBe(3);
  });

  it('accumulates repeated Join taps instead of clamping them to one kit', () => {
    useCart.getState().add(kahati({ qty: 7 }));
    useCart.getState().add(kahati({ qty: 7 }));

    expect(useCart.getState().items[0].qty).toBe(14);
  });

  it('keeps a manual quantity edit above one kit', () => {
    useCart.getState().add(kahati({ qty: 2 }));
    useCart.getState().setQty('gb:g1', 99);

    expect(useCart.getState().items[0].qty).toBe(99);
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

  // Nothing to clamp to: the shelf holds no stock, and a big order is what
  // fills the target rather than something to protect the shelf from.
  it('lets an MOQ line grow as large as the customer wants', () => {
    useCart.getState().add(moqItem({ qty: 5, stock: 8 }));
    useCart.getState().setQty('moq:m1', 99);
    expect(useCart.getState().items[0].qty).toBe(99);
  });

  it('counts MOQ units toward the cart badge and subtotal', () => {
    useCart.getState().add(moqItem({ qty: 5 }));
    expect(useCart.getState().count()).toBe(5);
    expect(useCart.getState().subtotal()).toBe(22500);
  });
});

