// What the order calculator promises about a quote.
//
// The calculator is a money surface that runs entirely on the client, so every
// number it shows has to come from this module rather than from a component's
// own arithmetic — a total assembled inline in JSX is a total nobody can test.
import { describe, it, expect } from 'vitest';
import {
  LOW_STOCK_VIALS,
  SEARCH_LIMIT,
  addEntry,
  buildLines,
  orderTotals,
  searchProducts,
  setEntryQty,
  stockState,
  vialPrice,
  type CalcProduct,
} from './order-calc';

const product = (o: Partial<CalcProduct> = {}): CalcProduct => ({
  id: 'p1', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial',
  pricePhp: '695.5', onHandPiecePhp: '695.5', onHandKitPhp: null, stock: 40, ...o,
});

describe('stockState', () => {
  it('reads a zero or negative count as out of stock', () => {
    expect(stockState(0)).toBe('out');
    expect(stockState(-3)).toBe('out');
  });

  it('reads a count at or below the low-stock threshold as low', () => {
    expect(stockState(1)).toBe('low');
    expect(stockState(LOW_STOCK_VIALS)).toBe('low');
  });

  it('reads a count above the threshold as in stock', () => {
    expect(stockState(LOW_STOCK_VIALS + 1)).toBe('in');
  });
});

describe('vialPrice', () => {
  it('prefers the on-hand per-piece price', () => {
    expect(vialPrice(product({ onHandPiecePhp: '520', pricePhp: '999' }))).toBe(520);
  });

  // A product that is not stocked on-hand still belongs on the pricelist — the
  // calculator quotes the catalogue price rather than pretending it is free.
  it('falls back to the catalogue price when no piece price is set', () => {
    expect(vialPrice(product({ onHandPiecePhp: null, pricePhp: '1430' }))).toBe(1430);
  });

  it('falls back when the piece price is zero rather than treating it as free', () => {
    expect(vialPrice(product({ onHandPiecePhp: '0', pricePhp: '780' }))).toBe(780);
  });

  it('is zero, never NaN, when neither price is usable', () => {
    expect(vialPrice(product({ onHandPiecePhp: null, pricePhp: 'not-a-price' }))).toBe(0);
  });
});

describe('searchProducts', () => {
  const catalogue = [
    product({ id: 'a', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial' }),
    product({ id: 'b', code: 'BC10', name: 'BPC-157', spec: '10 mg/vial, 10 vials/kits' }),
    product({ id: 'c', code: 'CU50', name: 'GHK-CU', spec: '50 mg/vial' }),
  ];

  it('returns the whole catalogue for a blank query', () => {
    expect(searchProducts(catalogue, '   ')).toHaveLength(3);
  });

  // The products API only filters on name and spec, so code search has to be
  // done here — a customer reading a pricelist knows the code, not the spelling.
  it('matches on product code, case-insensitively', () => {
    expect(searchProducts(catalogue, 'bc10').map((p) => p.id)).toEqual(['b']);
  });

  it('matches on name', () => {
    expect(searchProducts(catalogue, 'tirze').map((p) => p.id)).toEqual(['a']);
  });

  it('matches on spec', () => {
    expect(searchProducts(catalogue, 'vials/kits').map((p) => p.id)).toEqual(['b']);
  });

  it('tolerates a product with no code', () => {
    const noCode = [product({ id: 'z', code: null, name: 'Mystery blend' })];
    expect(searchProducts(noCode, 'mystery').map((p) => p.id)).toEqual(['z']);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchProducts(catalogue, 'zzzz')).toEqual([]);
  });

  it('caps the result list so a blank query cannot render the whole catalogue', () => {
    const many = Array.from({ length: SEARCH_LIMIT + 25 }, (_, i) => product({ id: `p${i}` }));
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
    expect(addEntry([{ id: 'a', qty: 1 }], 'b')).toEqual([{ id: 'a', qty: 1 }, { id: 'b', qty: 1 }]);
  });

  it('does not mutate the entries it was given', () => {
    const entries = [{ id: 'a', qty: 1 }];
    addEntry(entries, 'a');
    expect(entries).toEqual([{ id: 'a', qty: 1 }]);
  });
});

describe('setEntryQty', () => {
  it('sets the quantity of an existing line', () => {
    expect(setEntryQty([{ id: 'a', qty: 1 }], 'a', 5)).toEqual([{ id: 'a', qty: 5 }]);
  });

  // Stepping down from one is how the design removes a line, so zero has to
  // drop it rather than leave a ghost row worth nothing.
  it('removes the line when the quantity reaches zero', () => {
    expect(setEntryQty([{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }], 'a', 0)).toEqual([{ id: 'b', qty: 2 }]);
  });

  it('removes the line on a negative quantity too', () => {
    expect(setEntryQty([{ id: 'a', qty: 1 }], 'a', -4)).toEqual([]);
  });

  it('does not mutate the entries it was given', () => {
    const entries = [{ id: 'a', qty: 1 }];
    setEntryQty(entries, 'a', 9);
    expect(entries).toEqual([{ id: 'a', qty: 1 }]);
  });
});

describe('buildLines', () => {
  const catalogue = [
    product({ id: 'a', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial', onHandPiecePhp: '695.5' }),
    product({ id: 'b', code: 'BC10', name: 'BPC-157', spec: '10 mg/vial', onHandPiecePhp: '565.5' }),
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

  it('carries the stock count through so a line can show its badge', () => {
    const [line] = buildLines([product({ id: 'a', stock: 4 })], [{ id: 'a', qty: 1 }]);
    expect(line.stock).toBe(4);
  });

  it('is empty for an empty order', () => {
    expect(buildLines(catalogue, [])).toEqual([]);
  });
});

describe('orderTotals', () => {
  const lines = buildLines(
    [product({ id: 'a', onHandPiecePhp: '500' }), product({ id: 'b', onHandPiecePhp: '250' })],
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
    const odd = buildLines([product({ id: 'a', onHandPiecePhp: '110.5' })], [{ id: 'a', qty: 3 }]);
    expect(orderTotals(odd, 0).subtotal).toBe(331.5);
  });
});
