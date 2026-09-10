// Which catalog rows the two boards may carry — the rule, on its own.
//
// The switches (`is_group_buy`, `is_kahati`) are a per-product permission an
// admin ticks. Nobody was going to tick them 164 times, so lib/product-board-bulk.ts
// ticks them by rule instead — and this is that rule, kept pure so it can be
// argued with here rather than against production.
//
// The rule it encodes is the hatian's own shape: a counter splits ONE SUPPLIER
// KIT ten ways. A row whose kit is one prefilled syringe, one 30ml bottle, or a
// sheet of stickers has nothing to split, and a counter over it promises a
// per-vial share of something that has no vials.
import { describe, it, expect } from 'vitest';
import { isAccessory, isBoardEligible } from './product-board-eligibility';

// An ordinary peptide as the catalog stores it: ten vials to a supplier kit,
// priced per kit, stating no group buy terms of its own.
const peptide = {
  name: 'Retatrutide',
  kitSize: 10,
  pricePhp: '5688.00',
  gbPricePerKitPhp: null,
  gbPricePerPiecePhp: null,
  gbVialsPerKit: null,
};

describe('isBoardEligible', () => {
  it('accepts a peptide whose supplier kit holds ten vials', () => {
    expect(isBoardEligible(peptide)).toBe(true);
  });

  it('accepts a kit that states ten vials explicitly', () => {
    expect(isBoardEligible({ ...peptide, gbVialsPerKit: 10 })).toBe(true);
  });

  it('refuses a single prefilled syringe — a hatian has nothing to split', () => {
    // Rejuran i, Nabota, Profhilo: the supplier ships one unit, not a kit.
    expect(isBoardEligible({ ...peptide, name: 'Rejuran i', kitSize: 1 })).toBe(false);
  });

  it('refuses a two-syringe filler pack', () => {
    expect(isBoardEligible({ ...peptide, name: 'JUVEDERM Ultra 2', kitSize: 2 })).toBe(false);
  });

  it('refuses a ten-count kit that says it splits one way', () => {
    // REJURAN Silver Ampoule: kit_size 10 left over from an import, but its own
    // terms say one 30ml bottle. The product's explicit figure wins.
    expect(isBoardEligible({
      ...peptide, name: 'REJURAN Silver Ampoule Serum', gbVialsPerKit: 1,
    })).toBe(false);
  });

  it('refuses a mis-keyed vials-per-kit rather than guessing at it', () => {
    // Tirzepatide (Pen Cartridge) 30mg carries 110. That is a typo, and a rule
    // that quietly rounded it to ten would list a product on terms nobody set.
    expect(isBoardEligible({ ...peptide, gbVialsPerKit: 110 })).toBe(false);
  });

  it('refuses a row with no usable price — a free kit is worse than an absent one', () => {
    // ACETIC ACID sits at ₱0 with no group buy price. seededKitPrice refuses to
    // open a counter for it, so the switch must not be ticked either.
    expect(isBoardEligible({ ...peptide, name: 'ACETIC ACID', pricePhp: '0.00' })).toBe(false);
  });

  it('accepts a ₱0 shop price when the product states its own group buy price', () => {
    // The shop price is only the fallback; an explicit kit price is enough.
    expect(isBoardEligible({
      ...peptide, pricePhp: '0.00', gbPricePerKitPhp: '4200.00',
    })).toBe(true);
  });

  it('refuses the packaging rows, whatever their kit size says', () => {
    expect(isBoardEligible({
      ...peptide, name: 'VIAL HOLOGRAPHIC STICKER', pricePhp: '5.00',
    })).toBe(false);
  });
});

describe('isAccessory', () => {
  it('names the sticker rows however they are cased or spaced', () => {
    expect(isAccessory('VIAL HOLOGRAPHIC STICKER')).toBe(true);
    expect(isAccessory('vial holographic sticker')).toBe(true);
    expect(isAccessory('  VIAL  HOLOGRAPHIC  STICKER  ')).toBe(true);
  });

  it('leaves an ordinary product alone', () => {
    expect(isAccessory('Retatrutide')).toBe(false);
    expect(isAccessory('BPC157')).toBe(false);
  });
});
