import { describe, it, expect } from 'vitest';
import {
  computeTotals, subtotal, packingFeeFor, perVialPrice,
  validateKahatiCommit, soloMoqStatus, hasSolo, hasKahati, hasGroupBuy,
  validateGroupBuyCommit, groupBuyMoqStatus, validateSoloCheckout,
  PACKING_FEE_PHP, KAHATI_MIN_VIALS, GROUP_BUY_MIN_KITS,
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
  it('charges the on-hand fee for a solo-only cart', () => {
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
  it('labels solo-only carts as solo', () => {
    expect(computeTotals([product(3200)]).buyType).toBe('solo');
  });
  it('labels any cart containing kahati as kahati', () => {
    expect(computeTotals([product(3200), kahati(900)]).buyType).toBe('kahati');
  });
  it('computes a solo total with the on-hand packing fee', () => {
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
    expect(hasSolo([product(1)])).toBe(true);
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

describe('validateSoloCheckout', () => {
  it('blocks checkout below 10 kits + 10 BAC', () => {
    expect(validateSoloCheckout(50, 3).ok).toBe(false);
    expect(validateSoloCheckout(100, 3).ok).toBe(false);
    expect(validateSoloCheckout(50, 10).ok).toBe(false);
  });
  it('allows checkout once both minimums are met', () => {
    expect(validateSoloCheckout(100, 10).ok).toBe(true);
  });
});

describe('soloMoqStatus', () => {
  it('flags when 10 kits + 10 BAC are met', () => {
    const s = soloMoqStatus(100, 10); // 100 vials = 10 kits
    expect(s.met).toBe(true);
  });
  it('flags when below minimums', () => {
    const s = soloMoqStatus(50, 3);
    expect(s.meetsKits).toBe(false);
    expect(s.meetsBac).toBe(false);
    expect(s.met).toBe(false);
  });
});
