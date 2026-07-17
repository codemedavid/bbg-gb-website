import { describe, it, expect } from 'vitest';
import {
  computeTotals, subtotal, shippingFor, repackFeeFor, perVialPrice,
  validateKahatiCommit, soloMoqStatus, hasSolo, hasKahati,
  SHIPPING_PHP, REPACK_FEE_PHP, KAHATI_MIN_VIALS, type PriceableItem,
} from './pricing.js';

const product = (price: number, qty = 1): PriceableItem => ({ kind: 'product', unitPricePhp: price, qty });
const kahati = (price: number, qty = 7): PriceableItem => ({ kind: 'group_buy', unitPricePhp: price, qty });

describe('subtotal', () => {
  it('sums unit price times qty', () => {
    expect(subtotal([product(3200, 2), product(475, 1)])).toBe(6875);
  });
  it('is zero for empty cart', () => {
    expect(subtotal([])).toBe(0);
  });
});

describe('shipping and repack rules', () => {
  it('charges LBC shipping only when solo items are present', () => {
    expect(shippingFor([product(3200)])).toBe(SHIPPING_PHP);
    expect(shippingFor([kahati(900)])).toBe(0);
  });
  it('charges repack fee only when kahati items are present', () => {
    expect(repackFeeFor([kahati(900)])).toBe(REPACK_FEE_PHP);
    expect(repackFeeFor([product(3200)])).toBe(0);
  });
  it('applies both fees for a mixed cart', () => {
    const items = [product(3200), kahati(900, 7)];
    expect(hasSolo(items)).toBe(true);
    expect(hasKahati(items)).toBe(true);
    const t = computeTotals(items);
    expect(t.shipping).toBe(SHIPPING_PHP);
    expect(t.repackFee).toBe(REPACK_FEE_PHP);
    expect(t.total).toBe(3200 + 900 * 7 + SHIPPING_PHP + REPACK_FEE_PHP);
  });
});

describe('computeTotals', () => {
  it('labels solo-only carts as solo', () => {
    expect(computeTotals([product(3200)]).buyType).toBe('solo');
  });
  it('labels any cart containing kahati as kahati', () => {
    expect(computeTotals([product(3200), kahati(900)]).buyType).toBe('kahati');
  });
  it('computes a solo total with shipping', () => {
    const t = computeTotals([product(3200, 2)]);
    expect(t).toMatchObject({ subtotal: 6400, shipping: 180, repackFee: 0, total: 6580, buyType: 'solo' });
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
});

describe('admin-editable kahati overrides', () => {
  it('enforces the group buy minVials over the default 7', () => {
    // Admin raised this kahati's minimum to 20 vials; a 7-vial commit must be rejected.
    expect(validateKahatiCommit(7, 100, 20).ok).toBe(false);
    expect(validateKahatiCommit(20, 100, 20).ok).toBe(true);
  });
  it('falls back to the default minimum when the group buy sets none', () => {
    expect(validateKahatiCommit(KAHATI_MIN_VIALS - 1, 100).ok).toBe(false);
    expect(validateKahatiCommit(KAHATI_MIN_VIALS, 100).ok).toBe(true);
  });
  it('charges the group buy repack fee over the default 150', () => {
    expect(repackFeeFor([{ kind: 'group_buy', unitPricePhp: 900, qty: 7, repackFeePhp: 200 }])).toBe(200);
  });
  it('falls back to the default repack fee when the group buy sets none', () => {
    expect(repackFeeFor([kahati(900)])).toBe(REPACK_FEE_PHP);
  });
  it('charges a single repack fee for a mixed cart using the edited fee', () => {
    const t = computeTotals([product(3200), { kind: 'group_buy', unitPricePhp: 900, qty: 7, repackFeePhp: 200 }]);
    expect(t.repackFee).toBe(200);
    expect(t.total).toBe(3200 + 900 * 7 + SHIPPING_PHP + 200);
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
