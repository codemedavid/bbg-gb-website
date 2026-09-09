// Planning a price adjustment from the client's workbook — pure, no database.
//
// Nothing here writes. It produces a PLAN an admin can read before any money
// changes, because the two ways this goes wrong are both silent: a row matched
// to the wrong product reprices something nobody looked at, and a row matched
// to nothing disappears without ever being applied.
import { describe, it, expect } from 'vitest';
import { planPriceAdjustment, type AdjustmentRow, type PriceableProduct } from './price-adjustment';

const sheetRow = (o: Partial<AdjustmentRow> = {}): AdjustmentRow => ({
  row: 2, name: 'Selank', size: '10mg', code: 'SK10', php: 3263, ...o,
});

const product = (o: Partial<PriceableProduct> = {}): PriceableProduct => ({
  id: 'p1', name: 'Selank', spec: '10mg', code: 'SK10',
  pricePhp: 3200, isKahati: true, isOnHand: false, ...o,
});

describe('planPriceAdjustment', () => {
  it('plans the new price for a kahati product', () => {
    const plan = planPriceAdjustment([sheetRow()], [product()]);

    expect(plan.updates).toEqual([
      { productId: 'p1', name: 'Selank', spec: '10mg', fromPhp: 3200, toPhp: 3263 },
    ]);
  });

  // The client's rule: "no onhand — separate entity ung prices ng onhand".
  // Prod holds two Selanks, one kahati at 3200 and one on-hand at 3100, under
  // the same code. Repricing the retail one off a group-buy sheet would move a
  // price nobody asked to move.
  it('leaves a product that is only sold on-hand alone', () => {
    const plan = planPriceAdjustment(
      [sheetRow()],
      [product({ id: 'retail', isKahati: false, isOnHand: true, pricePhp: 3100 })],
    );

    expect(plan.updates).toEqual([]);
    expect(plan.skippedOnHand.map((s) => s.productId)).toEqual(['retail']);
  });

  it('reprices the kahati twin and not the on-hand one', () => {
    const plan = planPriceAdjustment([sheetRow()], [
      product({ id: 'kahati', isKahati: true, pricePhp: 3200 }),
      product({ id: 'retail', isKahati: false, isOnHand: true, pricePhp: 3100 }),
    ]);

    expect(plan.updates.map((u) => u.productId)).toEqual(['kahati']);
    expect(plan.skippedOnHand.map((s) => s.productId)).toEqual(['retail']);
  });

  // A wrong price is money. Two candidates means the sheet does not say which,
  // and guessing is the one thing this must never do.
  it('reports an ambiguous row instead of guessing', () => {
    const plan = planPriceAdjustment([sheetRow()], [
      product({ id: 'a' }),
      product({ id: 'b' }),
    ]);

    expect(plan.updates).toEqual([]);
    expect(plan.ambiguous).toHaveLength(1);
    expect(plan.ambiguous[0].candidates).toEqual(['a', 'b']);
  });

  it('reports a row that matches nothing rather than dropping it', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Something We Do Not Stock', code: 'NOPE' })],
      [product()],
    );

    expect(plan.updates).toEqual([]);
    expect(plan.unmatched.map((u) => u.name)).toEqual(['Something We Do Not Stock']);
  });

  // Size is part of the identity: 5mg and 10mg of the same peptide are
  // different products at different prices.
  it('does not match a different size of the same product', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ size: '5mg' })],
      [product({ spec: '10mg vial' })],
    );

    expect(plan.updates).toEqual([]);
    expect(plan.unmatched).toHaveLength(1);
  });

  it('leaves a price that is already correct out of the updates', () => {
    const plan = planPriceAdjustment([sheetRow({ php: 3200 })], [product({ pricePhp: 3200 })]);

    expect(plan.updates).toEqual([]);
    expect(plan.unchanged.map((u) => u.productId)).toEqual(['p1']);
  });

  // lib/pricelist-match.ts already carries the client's standing exclusion:
  // the FUAN GTT is MOQ-shelf only and must not enter the group-buy catalog.
  it('honours the standing exclusions', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'GTT FUAN', size: '1500mg', code: 'GTT1500', php: 3213 })],
      [product({ id: 'gtt', name: 'GTT FUAN', spec: '1500mg' })],
    );

    expect(plan.updates).toEqual([]);
    expect(plan.excluded).toHaveLength(1);
  });

  // Every row must come back under exactly one heading, or the report silently
  // under-reports what the import did.
  it('accounts for every row exactly once', () => {
    const rows = [
      sheetRow({ row: 2 }),
      sheetRow({ row: 3, name: 'Unknown Thing' }),
      sheetRow({ row: 4, php: 3200 }),
    ];
    const plan = planPriceAdjustment(rows, [product()]);

    const accounted = plan.updates.length + plan.unchanged.length
      + plan.ambiguous.length + plan.unmatched.length + plan.excluded.length
      + plan.skippedOnHand.length;
    expect(accounted).toBe(rows.length);
  });

  it('never proposes a change to an on-hand price column', () => {
    const plan = planPriceAdjustment([sheetRow()], [product()]);

    const keys = Object.keys(plan.updates[0]);
    expect(keys.filter((k) => /onhand|on_hand/i.test(k))).toEqual([]);
    expect(keys).toEqual(['productId', 'name', 'spec', 'fromPhp', 'toPhp']);
  });
});
