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
  pricePhp: 3200, gbPricePerKitPhp: null, isKahati: true, isOnHand: false, ...o,
});

describe('planPriceAdjustment', () => {
  it('plans the new price for a kahati product', () => {
    const plan = planPriceAdjustment([sheetRow()], [product()]);

    expect(plan.updates).toEqual([
      { row: 2, productId: 'p1', name: 'Selank', spec: '10mg', fromPhp: 3200, fromGroupBuyPhp: null, toPhp: 3263 },
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
  // The GTT exclusion is an IMPORT rule: "everything except the GTT" was about
  // what becomes a catalog product. It says nothing about a GTT that is already
  // in the catalog and on both boards — prod holds one, and on 2026-09-10 both
  // its counter and its batch were still quoting the old money because the
  // exclusion kept the sheet's price off it.
  it('honours the standing exclusions for a row that matches nothing', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'GTT FUAN', size: '1500mg', code: 'GTT1500', php: 3213 })],
      [product()],
    );

    expect(plan.updates).toEqual([]);
    expect(plan.unmatched).toEqual([]);
    expect(plan.excluded).toHaveLength(1);
  });

  it('reprices a product the import exclusion would have kept off the catalog', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'GTT FUAN', size: '1500mg', code: 'GTT1500', php: 3213 })],
      [product({ id: 'gtt', name: 'GTT FUAN', spec: '1500MG', pricePhp: 3150 })],
    );

    expect(plan.excluded).toEqual([]);
    expect(plan.updates.map((u) => [u.productId, u.toPhp])).toEqual([['gtt', 3213]]);
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

    const seen = new Set([
      ...plan.updates.map(() => null), // updates carry no row; counted below
    ]);
    void seen;
    const rowsAccounted = new Set<number>([
      ...plan.unchanged.map((u) => u.row),
      ...plan.skippedOnHand.map((u) => u.row),
      ...plan.ambiguous.map((a) => a.row),
      ...plan.unmatched.map((u) => u.row),
      ...plan.excluded.map((e) => e.row),
      ...plan.updates.map((u) => u.row),
    ]);
    expect([...rowsAccounted].sort()).toEqual(rows.map((r) => r.row));
  });

  it('never proposes a change to an on-hand price column', () => {
    const plan = planPriceAdjustment([sheetRow()], [product()]);

    const keys = Object.keys(plan.updates[0]);
    expect(keys.filter((k) => /onhand|on_hand/i.test(k))).toEqual([]);
    expect(keys).toEqual(['row', 'productId', 'name', 'spec', 'fromPhp', 'fromGroupBuyPhp', 'toPhp']);
  });
});


// The catalog carries duplicate rows: a real kahati product beside an orphan
// twin that is neither kahati nor on-hand, differing only in formatting
// ("AICAR" 50mg vial vs "Aicar " 50mg). Nine workbook rows matched a pair like
// that and none of them applied.
//
// The orphans are dead weight, so the kahati one wins. Where that does not
// settle it — two live kahati products, or two orphans — the row stays
// ambiguous, because then the sheet really does not say.
describe('a workbook row that matches a duplicated catalog entry', () => {
  it('prefers the kahati product over its orphan twin', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Aicar', size: '50mg', code: 'AR50', php: 3663 })],
      [
        product({ id: 'kahati', name: 'AICAR', spec: '50mg vial', pricePhp: 3600, isKahati: true, isOnHand: true }),
        product({ id: 'orphan', name: 'Aicar ', spec: '50mg', pricePhp: 3200, isKahati: false, isOnHand: false }),
      ],
    );

    expect(plan.updates.map((u) => u.productId)).toEqual(['kahati']);
    expect(plan.ambiguous).toEqual([]);
  });

  // Two LIVE products tied on price is still worth a human look: repricing a
  // real pair off one sheet row should not happen quietly.
  it('stays ambiguous when two live kahati products tie on price', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Oxytocin', size: '10mg', code: 'OT10', php: 3263 })],
      [
        product({ id: 'a', name: 'Oxytocin', spec: '10mg vial', pricePhp: 3200, isKahati: true }),
        product({ id: 'b', name: 'Oxytocin', spec: '10mg', pricePhp: 3200, isKahati: true }),
      ],
    );

    expect(plan.updates).toEqual([]);
    expect(plan.ambiguous[0].candidates).toEqual(['a', 'b']);
  });
});

// Four rows named a product the catalog spells differently, so the matcher
// found nothing and the price never moved. lib/pricelist-match.ts already keeps
// an ALIASES map for exactly this — spreadsheet spellings no amount of
// normalisation bridges.
describe('names the workbook spells differently from the catalog', () => {
  const cases: { row: AdjustmentRow; product: PriceableProduct; to: number }[] = [
    {
      row: sheetRow({ name: 'Relaxation PM (RP 226)', size: '10ml', code: 'RP226', php: 6063 }),
      product: product({ id: 'rp', name: 'Relaxation PM (RP 226)', spec: '10ml', pricePhp: 6000 }),
      to: 6063,
    },
    {
      row: sheetRow({ name: 'Lipo C B12 Plus (LC396)', size: '10ml', code: 'LC396', php: 5013 }),
      product: product({ id: 'lc', name: 'Lipo C B12 Plus (LC396)', spec: '10ml', pricePhp: 4950 }),
      to: 5013,
    },
    {
      // The workbook says Cagrilintide; the catalog says Cagrilentide.
      row: sheetRow({ name: 'Tirzepatide 30mg + Cagrilintide 5mg', size: '35mg', code: 'TRC35', php: 9063 }),
      product: product({ id: 'trc', name: 'Tirzepatide 30mg + Cagrilentide 5mg', spec: '35mg', pricePhp: 9000 }),
      to: 9063,
    },
    {
      row: sheetRow({ name: 'Wolverine (TB500+BPC)', size: '10mg vial', code: 'WOLV', php: 6363 }),
      product: product({ id: 'wolv', name: 'Wolverine (TB500+BPC)', spec: '10mg vial', pricePhp: 6300 }),
      to: 6363,
    },
  ];

  // The client confirmed SALTFORM-KPV20 is a new product. It is created under
  // the catalog's own convention — "KPV (SALTFORM)", matching "SS31 (SALTFORM)"
  // — rather than under the workbook's "SALTFORM-KPV20", so the alias is what
  // joins the two.
  it('matches the new saltform KPV to the catalog name', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'SALTFORM-KPV20', size: '20mg', code: 'SALT-KPV20', php: 6600 })],
      [product({ id: 'kpv-salt', name: 'KPV (SALTFORM)', spec: '20mg', pricePhp: 6600 })],
    );

    expect(plan.unmatched).toEqual([]);
    expect(plan.unchanged.map((u) => u.productId)).toEqual(['kpv-salt']);
  });

  // The 10mg KPV is a different product at a different price and must not be
  // caught by the alias.
  it('does not drag the plain 10mg KPV in with it', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'SALTFORM-KPV20', size: '20mg', code: 'SALT-KPV20', php: 6600 })],
      [product({ id: 'kpv10', name: 'KPV', spec: '10mg vial', pricePhp: 3563 })],
    );

    expect(plan.updates).toEqual([]);
    expect(plan.unmatched).toHaveLength(1);
  });

  // Two saltform products the catalog misspells: "Tesamorilin (Saltform)"
  // (SALTTS5, SALTTS10) and "CAGRILENTIDE (SALTFORM)" (CGL5). Their prices
  // already agree with the workbook, which is how three rows a run should have
  // reported as unchanged came back as unmatched instead.
  it('matches Tesamorelin (Saltform) to the catalog’s Tesamorilin', () => {
    const plan = planPriceAdjustment(
      [
        sheetRow({ row: 29, name: 'Tesamorelin (Saltform)', size: '10mg', code: 'SALTTS10', php: 11900 }),
        sheetRow({ row: 30, name: 'Tesamorelin (Saltform)', size: '5mg', code: 'SALTTS5', php: 6200 }),
      ],
      [
        product({ id: 'ts10', name: 'Tesamorilin (Saltform)', spec: '10mg', pricePhp: 11900 }),
        product({ id: 'ts5', name: 'Tesamorilin (Saltform)', spec: '5mg', pricePhp: 6200 }),
        product({ id: 'plain10', name: 'Tesamorelin', spec: '10mg vial', pricePhp: 9663 }),
      ],
    );

    expect(plan.unmatched).toEqual([]);
    expect(plan.unchanged.map((u) => u.productId).sort()).toEqual(['ts10', 'ts5']);
  });

  it('matches Cagrilintide (Saltform) to the catalog’s CAGRILENTIDE (SALTFORM)', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Cagrilintide (Saltform)', size: '5mg', code: 'SALT-CGL5', php: 6600 })],
      [
        product({ id: 'salt', name: 'CAGRILENTIDE (SALTFORM)', spec: '5mg', pricePhp: 6600 }),
        product({ id: 'plain', name: 'Cagrilintide', spec: '5mg vial', pricePhp: 5563 }),
      ],
    );

    expect(plan.unmatched).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged.map((u) => u.productId)).toEqual(['salt']);
  });

  // Created under the catalog's convention, which keeps the doses in the name
  // — the shape TRC35 already set — so the alias joins the two.
  it('matches the new Tirzepatide + Retatrutide blend', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Tirzepatide 20mg + Retatrutide 10mg', size: '30mg', code: 'TRR30', php: 7463 })],
      [product({ id: 'trr', name: 'Tirzepatide 20mg + Retatrutide 10mg', spec: '30mg', pricePhp: 7463 })],
    );

    expect(plan.unmatched).toEqual([]);
    expect(plan.unchanged.map((u) => u.productId)).toEqual(['trr']);
  });

  // The new GHK-Cu blend needs no alias: the catalog name carries no doses, so
  // baseName already reduces the workbook label onto it. Size keeps the 60mg
  // sibling out.
  it('matches the new GHK-Cu + KPV on name and size alone', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'GHKcu 100mg + KPV 20mg', size: '120mg', code: 'CUV120', php: 8463 })],
      [
        product({ id: 'cuv120', name: 'GHK-Cu + KPV', spec: '120mg vial', pricePhp: 8463 }),
        product({ id: 'cuv60', name: 'GHK-Cu + KPV', spec: '60mg vial', pricePhp: 4863 }),
      ],
    );

    expect(plan.unchanged.map((u) => u.productId)).toEqual(['cuv120']);
  });

  it.each(cases)('matches $row.name', ({ row, product: p, to }) => {
    const plan = planPriceAdjustment([row], [p]);

    expect(plan.unmatched).toEqual([]);
    expect(plan.updates).toEqual([
      { row: row.row, productId: p.id, name: p.name, spec: p.spec, fromPhp: p.pricePhp, toPhp: to },
    ]);
  });
});


// The client's rule for a duplicated catalog entry: "Yon higher price po ang
// inconsider natin" — where the catalog holds the same product twice at
// different prices, the dearer row is the live one.
describe('a duplicate the kahati flag does not settle', () => {
  // Oxytocin is two live kahati products, OXY10 at 2937.50 and OT10 at 3200.
  it('takes the dearer of two live kahati products', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Oxytocin', size: '10mg', code: 'OT10', php: 3263 })],
      [
        product({ id: 'oxy10', name: 'Oxytocin', spec: '10mg vial', pricePhp: 2937.5, isKahati: true }),
        product({ id: 'ot10', name: 'Oxytocin', spec: '10mg', pricePhp: 3200, isKahati: true }),
      ],
    );

    expect(plan.ambiguous).toEqual([]);
    expect(plan.updates.map((u) => u.productId)).toEqual(['ot10']);
  });

  // The Rejuran pair is the same product listed twice at the SAME price, so
  // "dearer" picks neither. Updating one would leave its twin stale at the old
  // price — two rows for one product disagreeing about what it costs.
  it('moves both when duplicates are indistinguishable on price', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Rejuran GOLD & SILVER (Dual effect serum)', size: '30ml each', code: null, php: 2563 })],
      [
        product({ id: 'a', name: 'Rejuran GOLD & SILVER (Dual effect serum)', spec: '30ml', pricePhp: 2500, isKahati: false, isOnHand: false }),
        product({ id: 'b', name: ' Rejuran GOLD & SILVER (Dual effect serum)', spec: '30ml each', pricePhp: 2500, isKahati: false, isOnHand: false }),
      ],
    );

    expect(plan.ambiguous).toEqual([]);
    expect(plan.updates.map((u) => u.productId).sort()).toEqual(['a', 'b']);
  });

  // The kahati flag still leads: a live product is the answer even when the
  // dead twin beside it happens to carry a bigger number.
  it('still prefers the kahati product over a dearer orphan', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Aicar', size: '50mg', code: 'AR50', php: 3663 })],
      [
        product({ id: 'kahati', name: 'AICAR', spec: '50mg vial', pricePhp: 3600, isKahati: true }),
        product({ id: 'orphan', name: 'Aicar ', spec: '50mg', pricePhp: 9999, isKahati: false, isOnHand: false }),
      ],
    );

    expect(plan.updates.map((u) => u.productId)).toEqual(['kahati']);
  });
});

// The client confirmed the workbook's "JUVEDERM Volume" is the catalog's
// "JUVEDERM Voluma" — a spelling difference, not a different filler.
describe('JUVEDERM Volume', () => {
  it('matches the catalog Voluma', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'JUVEDERM Volume', size: '2 x 1ml prefilled syringes', code: 'JUVEDERMVol', php: 4063 })],
      [product({ id: 'vol', name: 'JUVEDERM Voluma', spec: '2x1ml prefilled syringes', pricePhp: 4000, isKahati: false, isOnHand: false })],
    );

    expect(plan.unmatched).toEqual([]);
    expect(plan.updates.map((u) => u.toPhp)).toEqual([4063]);
  });

  it('does not match a different JUVEDERM', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'JUVEDERM Volume', size: '2 x 1ml prefilled syringes', code: 'JUVEDERMVol', php: 4063 })],
      [product({ id: 'u3', name: 'JUVEDERM Ultra 3', spec: '2x1ml prefilled syringes', pricePhp: 4063 })],
    );

    expect(plan.updates).toEqual([]);
    expect(plan.unmatched).toHaveLength(1);
  });
});

// A listing is seeded at the product's OWN group buy kit price when it carries
// one, and only otherwise at the shop price (seededKitPrice). 102 of prod's 172
// products carry one, and it is the old kit price under a second column: the
// Sep 9 run moved products.price_php on 126 rows and left 45 of those overrides
// where they were, so 50 of 122 open counters and 40 of 124 open batches went
// on quoting last week's money. The workbook is headed FINAL PRICE — it is the
// price of the boards, so a product is only "at the new price" when both
// figures say so.
describe('a product whose group buy price still says the old money', () => {
  it('is repriced even though its shop price already moved', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Vilon', size: '20mg', code: 'VI20', php: 7263 })],
      [product({ id: 'vi20', name: 'VILON', spec: '20mg', pricePhp: 7263, gbPricePerKitPhp: 7200 })],
    );

    expect(plan.unchanged).toEqual([]);
    expect(plan.updates).toEqual([{
      row: 2, productId: 'vi20', name: 'VILON', spec: '20mg',
      fromPhp: 7263, fromGroupBuyPhp: 7200, toPhp: 7263,
    }]);
  });

  it('is left alone once both prices say the new figure', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Vilon', size: '20mg', code: 'VI20', php: 7263 })],
      [product({ id: 'vi20', name: 'VILON', spec: '20mg', pricePhp: 7263, gbPricePerKitPhp: 7263 })],
    );

    expect(plan.updates).toEqual([]);
    expect(plan.unchanged.map((u) => u.productId)).toEqual(['vi20']);
  });

  it('reports the group buy price it is moving from', () => {
    const plan = planPriceAdjustment(
      [sheetRow({ name: 'Cagrilintide', size: '10mg vial', code: 'CGL10', php: 8463 })],
      [product({ id: 'cgl10', name: 'Cagrilintide', spec: '10mg vial', pricePhp: 8000, gbPricePerKitPhp: 7500 })],
    );

    expect(plan.updates.map((u) => [u.fromPhp, u.fromGroupBuyPhp, u.toPhp])).toEqual([[8000, 7500, 8463]]);
  });
});
