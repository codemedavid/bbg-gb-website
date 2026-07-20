import { describe, it, expect } from 'vitest';
import {
  computeTotals, subtotal, packingFeeFor, perVialPrice,
  validateKahatiCommit, hasOnHand, hasKahati, hasGroupBuy,
  validateGroupBuyCommit, groupBuyMoqStatus, hasMoq, validateMoqQty,
  splitKahatiDownpayment, onHandUnitPrice, vialsFor, validateOnHandQty,
  PACKING_FEE_PHP, KAHATI_MIN_VIALS, GROUP_BUY_MIN_KITS, VIALS_PER_KIT,
  type PriceableItem,
} from './pricing';

const product = (price: number, qty = 1): PriceableItem => ({ kind: 'product', unitPricePhp: price, qty });
const kahati = (price: number, qty = 7): PriceableItem => ({ kind: 'group_buy', unitPricePhp: price, qty });
const moq = (price: number, qty = 1): PriceableItem => ({ kind: 'moq_campaign', unitPricePhp: price, qty });

describe('subtotal', () => {
  it('sums unit price times qty', () => {
    expect(subtotal([product(3200, 2), product(475, 1)])).toBe(6875);
  });
  it('is zero for empty cart', () => {
    expect(subtotal([])).toBe(0);
  });
});

describe('packing fee defaults (incl. local shipping, no admin fee)', () => {
  it('charges the on-hand fee for an on-hand-only cart', () => {
    expect(packingFeeFor([product(3200)])).toBe(PACKING_FEE_PHP.solo); // 200
  });
  it('charges the hatian fee for a kahati-only cart', () => {
    expect(packingFeeFor([kahati(900)])).toBe(PACKING_FEE_PHP.kahati); // 150
  });
  it('charges the pasabay fee for a group-buy-only cart', () => {
    expect(packingFeeFor([moq(10400)])).toBe(PACKING_FEE_PHP.group_buy); // 300
  });
  it('is zero for an empty cart', () => {
    expect(packingFeeFor([])).toBe(0);
  });
  it('sums one packing fee per fulfillment mode present (mixed cart)', () => {
    // Each mode checks out as its own order, so each carries its own packing fee.
    expect(packingFeeFor([product(3200), kahati(900, 7)])).toBe(
      PACKING_FEE_PHP.solo + PACKING_FEE_PHP.kahati, // 200 + 150 = 350
    );
    expect(packingFeeFor([product(3200), kahati(900), moq(10400)])).toBe(
      PACKING_FEE_PHP.solo + PACKING_FEE_PHP.kahati + PACKING_FEE_PHP.group_buy, // 650
    );
  });
});

describe('admin-editable packing-fee overrides', () => {
  it('charges the item override over the mode default', () => {
    expect(packingFeeFor([{ kind: 'group_buy', unitPricePhp: 900, qty: 7, packingFeePhp: 250 }])).toBe(250);
    expect(packingFeeFor([{ kind: 'moq_campaign', unitPricePhp: 10400, qty: 1, packingFeePhp: 400 }])).toBe(400);
  });
  it('takes the highest override across items of the same mode', () => {
    const items: PriceableItem[] = [
      { kind: 'group_buy', unitPricePhp: 900, qty: 7, packingFeePhp: 150 },
      { kind: 'group_buy', unitPricePhp: 800, qty: 7, packingFeePhp: 220 },
    ];
    expect(packingFeeFor(items)).toBe(220);
  });
  it('falls back to the mode default when an item sets no override', () => {
    expect(packingFeeFor([kahati(900)])).toBe(PACKING_FEE_PHP.kahati);
  });
  it('sums per-mode using the edited fee in a mixed cart', () => {
    const t = computeTotals([product(3200), { kind: 'group_buy', unitPricePhp: 900, qty: 7, packingFeePhp: 250 }]);
    expect(t.packingFee).toBe(PACKING_FEE_PHP.solo + 250);
    expect(t.total).toBe(3200 + 900 * 7 + PACKING_FEE_PHP.solo + 250);
  });
});

describe('computeTotals', () => {
  it('labels on-hand-only carts as solo', () => {
    expect(computeTotals([product(3200)]).buyType).toBe('solo');
  });
  it('labels any cart containing kahati as kahati', () => {
    expect(computeTotals([product(3200), kahati(900)]).buyType).toBe('kahati');
  });
  it('computes an on-hand total with the on-hand packing fee', () => {
    const t = computeTotals([product(3200, 2)]);
    expect(t).toMatchObject({ subtotal: 6400, packingFee: 200, total: 6600, buyType: 'solo' });
  });
  it('computes a kahati total with the hatian packing fee', () => {
    const t = computeTotals([kahati(900, 7)]);
    expect(t).toMatchObject({ subtotal: 6300, packingFee: 150, total: 6450, buyType: 'kahati' });
  });
  it('computes a group-buy total with the pasabay packing fee', () => {
    const t = computeTotals([moq(10400, 2)]);
    expect(t).toMatchObject({ subtotal: 20800, packingFee: 300, total: 21100, buyType: 'group_buy' });
  });
  it('never adds a separate shipping or admin fee', () => {
    const t = computeTotals([product(3200)]);
    expect(t).not.toHaveProperty('shipping');
    expect(t).not.toHaveProperty('repackFee');
    expect(t).not.toHaveProperty('adminFee');
    expect(t.total).toBe(3200 + PACKING_FEE_PHP.solo);
  });
});

describe('mode predicates', () => {
  it('detects each mode', () => {
    expect(hasOnHand([product(1)])).toBe(true);
    expect(hasKahati([kahati(1)])).toBe(true);
    expect(hasGroupBuy([moq(1)])).toBe(true);
  });
});

describe('perVialPrice', () => {
  it('divides kit price by 10 vials', () => {
    expect(perVialPrice(9000)).toBe(900);
    expect(perVialPrice(6875)).toBe(687.5);
  });
});

describe('validateKahatiCommit', () => {
  it('rejects below the 7-vial minimum', () => {
    expect(validateKahatiCommit(KAHATI_MIN_VIALS - 1, 100).ok).toBe(false);
  });
  it('rejects commitments beyond remaining slots', () => {
    const r = validateKahatiCommit(20, 10);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('10');
  });
  it('accepts a valid commitment', () => {
    expect(validateKahatiCommit(7, 50).ok).toBe(true);
  });
  it('rejects non-integer quantities', () => {
    expect(validateKahatiCommit(7.5, 50).ok).toBe(false);
  });
  it('enforces the group buy minVials over the default 7', () => {
    expect(validateKahatiCommit(7, 100, 20).ok).toBe(false);
    expect(validateKahatiCommit(20, 100, 20).ok).toBe(true);
  });
});

describe('group buy (MOQ) mode', () => {
  it('labels a group-buy-only cart as group_buy', () => {
    expect(computeTotals([moq(10400, 2)])).toMatchObject({
      subtotal: 20800, packingFee: PACKING_FEE_PHP.group_buy, total: 20800 + PACKING_FEE_PHP.group_buy, buyType: 'group_buy',
    });
  });
});

describe('validateGroupBuyCommit', () => {
  it('rejects below the per-customer minimum', () => {
    expect(validateGroupBuyCommit(GROUP_BUY_MIN_KITS - 1).ok).toBe(false);
  });
  it('accepts a commitment at or above the minimum', () => {
    expect(validateGroupBuyCommit(GROUP_BUY_MIN_KITS).ok).toBe(true);
    expect(validateGroupBuyCommit(5).ok).toBe(true);
  });
  it('honours a campaign-specific per-customer minimum', () => {
    expect(validateGroupBuyCommit(2, 3).ok).toBe(false);
    expect(validateGroupBuyCommit(3, 3).ok).toBe(true);
  });
  it('rejects non-integer commitments', () => {
    expect(validateGroupBuyCommit(2.5).ok).toBe(false);
  });
});

describe('groupBuyMoqStatus', () => {
  it('reports progress and not-yet-reached below MOQ', () => {
    const s = groupBuyMoqStatus(6, 10);
    expect(s.reached).toBe(false);
    expect(s.remaining).toBe(4);
    expect(s.progress).toBeCloseTo(0.6);
  });
  it('reports reached at or above MOQ and caps progress at 1', () => {
    const s = groupBuyMoqStatus(12, 10);
    expect(s.reached).toBe(true);
    expect(s.remaining).toBe(0);
    expect(s.progress).toBe(1);
  });
});

describe('onHandUnitPrice', () => {
  const p = { onHandPiecePhp: '550', onHandKitPhp: '5000' };

  it('prices a piece from onHandPiecePhp', () => {
    expect(onHandUnitPrice(p, 'piece')).toBe(550);
  });
  it('prices a kit from onHandKitPhp', () => {
    expect(onHandUnitPrice(p, 'kit')).toBe(5000);
  });
  it('returns null when the unit has no on-hand price set', () => {
    expect(onHandUnitPrice({ onHandPiecePhp: '550', onHandKitPhp: null }, 'kit')).toBeNull();
    expect(onHandUnitPrice({ onHandPiecePhp: null, onHandKitPhp: '5000' }, 'piece')).toBeNull();
  });
  it('treats a zero price as unset rather than free', () => {
    expect(onHandUnitPrice({ onHandPiecePhp: '0', onHandKitPhp: '5000' }, 'piece')).toBeNull();
  });
});

describe('vialsFor', () => {
  it('counts one vial per piece', () => {
    expect(vialsFor('piece', 3)).toBe(3);
  });
  it('counts ten vials per kit', () => {
    expect(vialsFor('kit', 2)).toBe(2 * VIALS_PER_KIT);
  });
});

describe('validateOnHandQty', () => {
  it('allows a single piece — on-hand has no bulk minimum', () => {
    expect(validateOnHandQty(1, 'piece', 100).ok).toBe(true);
  });
  it('rejects a non-positive or fractional quantity', () => {
    expect(validateOnHandQty(0, 'piece', 100).ok).toBe(false);
    expect(validateOnHandQty(1.5, 'piece', 100).ok).toBe(false);
  });
  it('rejects ordering more pieces than are in stock', () => {
    const r = validateOnHandQty(11, 'piece', 10);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('10');
  });
  it('counts a kit against stock as ten vials', () => {
    expect(validateOnHandQty(1, 'kit', 10).ok).toBe(true);
    expect(validateOnHandQty(2, 'kit', 10).ok).toBe(false);
  });
  it('rejects any quantity when stock is zero', () => {
    const r = validateOnHandQty(1, 'piece', 0);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Out of stock');
  });
});

describe('kahati downpayment split', () => {
  it('splits total into the default ₱150 downpayment and the balance', () => {
    expect(splitKahatiDownpayment(6450)).toEqual({ downpayment: 150, balance: 6300 });
  });
  it('honours an admin-set downpayment amount', () => {
    expect(splitKahatiDownpayment(6450, 500)).toEqual({ downpayment: 500, balance: 5950 });
  });
  it('caps the downpayment at the order total so balance never goes negative', () => {
    expect(splitKahatiDownpayment(100, 150)).toEqual({ downpayment: 100, balance: 0 });
  });
  it('floors a negative downpayment at zero', () => {
    expect(splitKahatiDownpayment(1000, -50)).toEqual({ downpayment: 0, balance: 1000 });
  });
  it('rounds to centavos', () => {
    expect(splitKahatiDownpayment(1000.505, 150.004)).toEqual({ downpayment: 150, balance: 850.51 });
  });
});

// ---------------------------------------------------------------------------
// MOQ (Minimum Order Quantity) — the fourth purchasing mode.
//
// MOQ products are a curated, admin-managed shelf sold on their own page with a
// per-product minimum order quantity. They never share an order with on-hand,
// kahati or group-buy items, so they carry their own packing fee.
// ---------------------------------------------------------------------------
describe('MOQ mode pricing', () => {
  const moqItem = (price: number, qty = 1): PriceableItem => ({ kind: 'moq_product', unitPricePhp: price, qty });

  it('exposes a dedicated MOQ packing-fee default', () => {
    expect(PACKING_FEE_PHP.moq).toBe(300);
  });

  it('charges the MOQ fee for an MOQ-only cart', () => {
    expect(packingFeeFor([moqItem(4500)])).toBe(PACKING_FEE_PHP.moq);
  });

  it('detects MOQ items with hasMoq and does not confuse them with group buys', () => {
    expect(hasMoq([moqItem(4500)])).toBe(true);
    expect(hasMoq([moq(10400)])).toBe(false);
    expect(hasGroupBuy([moqItem(4500)])).toBe(false);
  });

  it('adds a fourth packing fee when an MOQ item joins an all-modes cart', () => {
    expect(packingFeeFor([product(3200), kahati(900, 7), moq(10400), moqItem(4500)])).toBe(
      PACKING_FEE_PHP.solo + PACKING_FEE_PHP.kahati + PACKING_FEE_PHP.group_buy + PACKING_FEE_PHP.moq,
    );
  });

  it('honours a per-listing packing-fee override on an MOQ item', () => {
    expect(packingFeeFor([{ kind: 'moq_product', unitPricePhp: 4500, qty: 2, packingFeePhp: 450 }])).toBe(450);
  });

  it('reports buyType "moq" for an MOQ-only order segment', () => {
    expect(computeTotals([moqItem(4500, 3)])).toEqual({
      subtotal: 13500,
      packingFee: PACKING_FEE_PHP.moq,
      total: 13500 + PACKING_FEE_PHP.moq,
      buyType: 'moq',
    });
  });
});

describe('validateMoqQty', () => {
  it('accepts a quantity at the product minimum', () => {
    expect(validateMoqQty(5, 5, 100)).toEqual({ ok: true });
  });

  it('rejects a quantity below the minimum order quantity', () => {
    const r = validateMoqQty(4, 5, 100);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('5');
  });

  it('rejects a fractional quantity', () => {
    expect(validateMoqQty(5.5, 1, 100).ok).toBe(false);
  });

  it('rejects a quantity beyond available stock', () => {
    const r = validateMoqQty(20, 1, 12);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('12');
  });

  it('rejects any purchase when the product is out of stock', () => {
    const r = validateMoqQty(1, 1, 0);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/out of stock/i);
  });
});
