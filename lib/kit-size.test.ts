// Deriving a product's supplier pack size from the spec text it already carries.
//
// kit_size is the divisor behind the weekly report's Kits column, so getting it
// wrong under-orders a batch by exactly the factor it is wrong by. The live
// catalogue codes almost nothing (95 products, and the six codes the original
// backfill keyed on are absent), but the specs do state the pack size — every
// case below is a real spec string from the production catalogue.
import { describe, it, expect } from 'vitest';
import { kitSizeFromSpec, VIALS_PER_PEPTIDE_KIT } from './kit-size';

describe('kitSizeFromSpec', () => {
  // In "A x B" exactly one side carries a unit. The other is the count — which
  // is why "2x1ml" is 2 units and "2.5mlx10" is 10, despite the same shape.
  describe('multi-packs state their count on the side without a unit', () => {
    it('reads the leading number when the trailing side has the unit', () => {
      expect(kitSizeFromSpec('2x1ml prefilled syringes')).toBe(2);
      expect(kitSizeFromSpec('2x2ml prefilled syringes')).toBe(2);
      expect(kitSizeFromSpec('1x2ml')).toBe(1);
    });

    it('reads the trailing number when the leading side has the unit', () => {
      expect(kitSizeFromSpec('2.5mlx10 prefilled syringes')).toBe(10);
      expect(kitSizeFromSpec('2.2mlx3 prefilled syringes')).toBe(3);
    });

    it('reads a count separated by spaces around the x', () => {
      expect(kitSizeFromSpec('50ml x 10 vials')).toBe(10);
    });
  });

  describe('single units', () => {
    it('treats an explicit "per piece" as one', () => {
      expect(kitSizeFromSpec('per piece')).toBe(1);
    });

    it('treats a spelled-out single syringe as one', () => {
      expect(kitSizeFromSpec('1 prefilled syringe, 1ml')).toBe(1);
    });
  });

  // A peptide spec names one vial; the supplier kit holds ten of them. That is
  // the overwhelming majority of the catalogue, so it is what an unrecognised
  // spec falls back to — the same default the column already carries.
  describe('peptide vials fall back to the kit', () => {
    it('defaults a plain vial spec to a full kit', () => {
      expect(kitSizeFromSpec('15mg vial')).toBe(VIALS_PER_PEPTIDE_KIT);
      expect(kitSizeFromSpec('10mg vial')).toBe(VIALS_PER_PEPTIDE_KIT);
    });

    it('defaults an unrecognised or empty spec to a full kit', () => {
      expect(kitSizeFromSpec('100U')).toBe(VIALS_PER_PEPTIDE_KIT);
      expect(kitSizeFromSpec('')).toBe(VIALS_PER_PEPTIDE_KIT);
      expect(kitSizeFromSpec(null)).toBe(VIALS_PER_PEPTIDE_KIT);
    });
  });

  describe('never returns a value that would corrupt the division', () => {
    // kits = qty / kitSize. A zero here is an Infinity on the supplier sheet.
    it('never returns zero', () => {
      expect(kitSizeFromSpec('0x1ml')).toBeGreaterThan(0);
      expect(kitSizeFromSpec('0 vials')).toBeGreaterThan(0);
    });

    it('always returns a whole number', () => {
      for (const spec of ['2.5mlx10', '2x1ml', 'per piece', '15mg vial', '1.5x2ml']) {
        expect(Number.isInteger(kitSizeFromSpec(spec))).toBe(true);
      }
    });
  });
});

// The Skin Repair series is packed in PAIRS — one 1g powder vial with its 5mL
// solvent — and the price list sells five of them to a pack. "pair" was not a
// pack noun this recognised, so the whole series fell back to the 10-vial
// peptide kit and would have been ordered at twice what the sheet asked for.
describe('packs counted in pairs', () => {
  it('reads a pack stated in pairs', () => {
    expect(kitSizeFromSpec('1g + 5mL · 5 pairs')).toBe(5);
  });

  it('reads a single pair as a pack of one', () => {
    expect(kitSizeFromSpec('1 pair')).toBe(1);
  });

  it('does not mistake the solvent volume for the pack count', () => {
    // "5mL" is how much diluent comes with each vial, not how many pairs ship.
    expect(kitSizeFromSpec('1g + 5mL')).toBe(VIALS_PER_PEPTIDE_KIT);
  });
});
