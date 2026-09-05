// What the order calculator promises about a quote.
//
// The calculator is a money surface that runs entirely on the client, so every
// number it shows has to come from this module rather than from a component's
// own arithmetic — a total assembled inline in JSX is a total nobody can test.
import { describe, it, expect } from 'vitest';
import {
  SEARCH_LIMIT,
  addEntry,
  buildLines,
  orderTotals,
  searchProducts,
  setEntryQty,
  vialPrice,
  type CalcProduct,
} from './order-calc';

// pricePhp is a PER-KIT figure throughout — the workbook column is headed
// "PER KIT (10 VIALS) PRICE" (lib/db/data/catalog.ts) — so a fixture that means
// ₱695.50 a vial carries ₱6,955 a kit.
const product = (o: Partial<CalcProduct> = {}): CalcProduct => ({
  id: 'p1', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial',
  pricePhp: '6955', gbPricePerKitPhp: null, gbPricePerPiecePhp: null, gbVialsPerKit: null, ...o,
});

// The calculator quotes the two scheduled boards, so it has to quote what those
// boards charge. Both seed a kit through seededKitPrice and divide it down; a
// figure derived any other way is a price no board will honour.
describe('vialPrice', () => {
  it('uses the group buy per-piece price when the product sets one', () => {
    expect(vialPrice(product({ gbPricePerPiecePhp: '410', gbPricePerKitPhp: '5000' }))).toBe(410);
  });

  it('divides the group buy kit price by the kit size', () => {
    expect(vialPrice(product({ gbPricePerKitPhp: '4500' }))).toBe(450);
  });

  // The fallback both seeders take: absent an explicit group buy price, a kit
  // costs the shop price (lib/campaign-seed.ts, lib/kahati-seed.ts).
  it('falls back to the shop kit price, per vial', () => {
    expect(vialPrice(product({ pricePhp: '3200' }))).toBe(320);
  });

  it("honours a product's own vials-per-kit rather than assuming ten", () => {
    expect(vialPrice(product({ gbPricePerKitPhp: '2500', gbVialsPerKit: 5 }))).toBe(500);
  });

  // The whole point of this surface: an on-hand shelf price is a different
  // product on a different board, and quoting it here priced a group buy vial
  // at the ready-stock rate.
  it('ignores the on-hand shelf price entirely', () => {
    const p = { ...product({ pricePhp: '3200' }), onHandPiecePhp: '550', onHandKitPhp: '5000' };
    expect(vialPrice(p as CalcProduct)).toBe(320);
  });

  it('ignores a zero group buy price rather than reading it as free', () => {
    expect(vialPrice(product({ gbPricePerKitPhp: '0', pricePhp: '7800' }))).toBe(780);
  });

  it('is zero, never NaN, when no price is usable', () => {
    expect(vialPrice(product({ pricePhp: 'not-a-price' }))).toBe(0);
  });
});

describe('searchProducts', () => {
  const catalogue = [
    product({ id: 'a', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial' }),
    product({ id: 'b', code: 'BC10', name: 'BPC-157', spec: '10 mg/vial' }),
    product({ id: 'c', code: null, name: 'GHK-Cu', spec: '50 mg/vial' }),
  ];

  it('returns the whole catalogue for a blank query', () => {
    expect(searchProducts(catalogue, '   ')).toHaveLength(3);
  });

  it('matches on product code, case-insensitively', () => {
    expect(searchProducts(catalogue, 'tr15').map((p) => p.id)).toEqual(['a']);
  });

  it('matches on name', () => {
    expect(searchProducts(catalogue, 'BPC').map((p) => p.id)).toEqual(['b']);
  });

  it('matches on spec', () => {
    expect(searchProducts(catalogue, '50 mg').map((p) => p.id)).toEqual(['c']);
  });

  it('tolerates a product with no code', () => {
    expect(() => searchProducts(catalogue, 'ghk')).not.toThrow();
    expect(searchProducts(catalogue, 'ghk').map((p) => p.id)).toEqual(['c']);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchProducts(catalogue, 'zzzz')).toEqual([]);
  });

  it('caps the result list so a blank query cannot render the whole catalogue', () => {
    const many = Array.from({ length: SEARCH_LIMIT + 20 }, (_, i) => product({ id: `p${i}` }));
    expect(searchProducts(many, '')).toHaveLength(SEARCH_LIMIT);
  });
});

describe('addEntry', () => {
  it('adds a product that is not in the order yet', () => {
    expect(addEntry([], 'a')).toEqual([{ id: 'a', qty: 1 }]);
  });

  it('increments an existing line instead of duplicating it', () => {
    expect(addEntry([{ id: 'a', qty: 2 }], 'a')).toEqual([{ id: 'a', qty: 3 }]);
  });

  it('appends to the end so the order reads in the sequence it was built', () => {
    expect(addEntry([{ id: 'a', qty: 1 }], 'b').map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the entries it was given', () => {
    const before = [{ id: 'a', qty: 1 }];
    addEntry(before, 'a');
    expect(before).toEqual([{ id: 'a', qty: 1 }]);
  });
});

describe('setEntryQty', () => {
  it('sets the quantity of an existing line', () => {
    expect(setEntryQty([{ id: 'a', qty: 1 }], 'a', 5)).toEqual([{ id: 'a', qty: 5 }]);
  });

  it('removes the line when the quantity reaches zero', () => {
    expect(setEntryQty([{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }], 'a', 0)).toEqual([{ id: 'b', qty: 2 }]);
  });

  it('removes the line on a negative quantity too', () => {
    expect(setEntryQty([{ id: 'a', qty: 1 }], 'a', -2)).toEqual([]);
  });

  it('does not mutate the entries it was given', () => {
    const before = [{ id: 'a', qty: 1 }];
    setEntryQty(before, 'a', 4);
    expect(before).toEqual([{ id: 'a', qty: 1 }]);
  });
});

describe('buildLines', () => {
  const catalogue = [
    product({ id: 'a', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial', pricePhp: '6955' }),
    product({ id: 'b', code: 'BC10', name: 'BPC-157', spec: '10 mg/vial', pricePhp: '5655' }),
  ];

  it('prices each line at quantity times the vial price', () => {
    const [line] = buildLines(catalogue, [{ id: 'a', qty: 3 }]);
    expect(line).toMatchObject({ id: 'a', code: 'TR15', name: 'Tirzepatide', qty: 3, unitPrice: 695.5, lineTotal: 2086.5 });
  });

  it('keeps the order the customer built', () => {
    const lines = buildLines(catalogue, [{ id: 'b', qty: 1 }, { id: 'a', qty: 1 }]);
    expect(lines.map((l) => l.id)).toEqual(['b', 'a']);
  });

  // A product deactivated while the quote was open cannot be priced or named.
  // Dropping it is wrong by the amount it was worth; showing it at ₱0 is wrong
  // by the same amount AND asserts a price that is not true.
  it('drops an entry whose product is no longer in the catalogue', () => {
    expect(buildLines(catalogue, [{ id: 'a', qty: 1 }, { id: 'gone', qty: 4 }]).map((l) => l.id)).toEqual(['a']);
  });

  it('is empty for an empty order', () => {
    expect(buildLines(catalogue, [])).toEqual([]);
  });
});

describe('orderTotals', () => {
  const lines = buildLines(
    [product({ id: 'a', pricePhp: '5000' }), product({ id: 'b', pricePhp: '2500' })],
    [{ id: 'a', qty: 2 }, { id: 'b', qty: 4 }],
  );

  it('sums the line totals into a subtotal', () => {
    expect(orderTotals(lines, 200).subtotal).toBe(2000);
  });

  it('counts the vials across every line', () => {
    expect(orderTotals(lines, 200).vials).toBe(6);
  });

  it('adds the packing fee to the subtotal', () => {
    expect(orderTotals(lines, 200).total).toBe(2200);
  });

  // Nothing has been packed yet, so an empty order owes nothing — quoting a
  // ₱200 total over an empty basket is the one number here that is plainly false.
  it('charges no fee on an empty order', () => {
    expect(orderTotals([], 200)).toMatchObject({ subtotal: 0, fee: 0, total: 0, vials: 0 });
  });

  it('reports the fee it applied so the breakdown and the total agree', () => {
    expect(orderTotals(lines, 150).fee).toBe(150);
  });

  it('rounds a fractional subtotal to centavos rather than trailing float noise', () => {
    const odd = buildLines([product({ id: 'a', pricePhp: '1105' })], [{ id: 'a', qty: 3 }]);
    expect(orderTotals(odd, 0).subtotal).toBe(331.5);
  });
});
