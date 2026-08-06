// The Skin Repair (SM) series, taken from the BBG price-list card.
//
// Six colour-coded hero peptides, each a 1g powder vial paired with 5mL of
// solvent, sold five pairs to a pack at ₱1,975.00 — ₱395.00 a pair. The pack
// size matters beyond the shop: it is the divisor behind the weekly report's
// Kits column, so a series left on the 10-vial peptide default would be ordered
// at twice what the sheet asks for.
import { describe, it, expect } from 'vitest';
import { PRODUCTS } from './catalog';
import { kitSizeFromSpec } from '@/lib/kit-size';
import { kahatiDefaultsFor, groupBuyUnitPrice } from '@/lib/pricing';

const SM_CODES = ['SM1', 'SM2', 'SM3', 'SM4', 'SM5', 'SM6'] as const;
const series = PRODUCTS.filter((p) => p.code && /^SM[1-6]$/.test(p.code));
const byCode = new Map(series.map((p) => [p.code, p]));

// The card's own wording, so a later edit that reworded a product cannot
// quietly reassign what SM3 is for.
const COLOUR_AND_PURPOSE: Record<string, { colour: string; purpose: RegExp }> = {
  SM1: { colour: 'Green', purpose: /whitens skin/i },
  SM2: { colour: 'Brown', purpose: /antibacterial/i },
  SM3: { colour: 'Pink', purpose: /oil production/i },
  SM4: { colour: 'Black', purpose: /deep cleansing/i },
  SM5: { colour: 'Purple', purpose: /wrinkles/i },
  SM6: { colour: 'Blue', purpose: /hormonal/i },
};

describe('Skin Repair series', () => {
  it('carries all six SM products', () => {
    expect(series.map((p) => p.code)).toEqual([...SM_CODES]);
  });

  it('prices every one at the card figure, per pack', () => {
    // pricePhp is PER PACK throughout this catalogue, never per unit.
    for (const code of SM_CODES) {
      expect(byCode.get(code)?.pricePhp).toBe(1975);
    }
  });

  it('divides evenly into the per-pair price the card advertises', () => {
    // ₱1,975 over five pairs is ₱395 exactly. If a later edit changes the pack
    // size or the price without the other, this stops agreeing with the card.
    for (const code of SM_CODES) {
      const product = byCode.get(code)!;
      expect(product.pricePhp / product.kitSize!).toBe(395);
    }
  });

  it('packs five pairs, not the ten-vial peptide kit', () => {
    for (const code of SM_CODES) {
      expect(byCode.get(code)?.kitSize).toBe(5);
    }
  });

  it('states a pack size its own spec text agrees with', () => {
    // The stated kit_size and the one derived from the spec must not disagree:
    // a backfill run over the live catalogue reads the spec, and a mismatch
    // would silently rewrite the divisor the batch order is placed on.
    for (const product of series) {
      expect(kitSizeFromSpec(product.spec)).toBe(product.kitSize);
    }
  });

  it('quotes PHP only, as the card does', () => {
    for (const code of SM_CODES) {
      expect(byCode.get(code)?.priceUsd ?? null).toBeNull();
    }
  });

  it('files the series under skin', () => {
    for (const code of SM_CODES) {
      expect(byCode.get(code)?.cat).toBe('skin');
    }
  });

  it('keeps each colour on the purpose the card gives it', () => {
    for (const [code, { colour, purpose }] of Object.entries(COLOUR_AND_PURPOSE)) {
      const product = byCode.get(code)!;
      expect(product.name).toContain(colour);
      expect(product.description ?? '').toMatch(purpose);
    }
  });

  it('describes each product individually rather than by category', () => {
    // Six products that differ only in what they treat are indistinguishable in
    // the shop if they all inherit one category blurb.
    const descriptions = series.map((p) => p.description);
    expect(descriptions.every(Boolean)).toBe(true);
    expect(new Set(descriptions).size).toBe(SM_CODES.length);
  });
});

// Both boards carry this series, so each product has to state its own group-buy
// terms: kahati-seed-bulk and campaign-seed-bulk select on `isGroupBuy` and seed
// every listing from these five fields.
describe('Skin Repair series — group buy terms', () => {
  it('is offered through the group buy boards', () => {
    for (const product of series) {
      expect(product.isGroupBuy).toBe(true);
    }
  });

  it('prices a pack and a pair at the card figures', () => {
    for (const product of series) {
      expect(product.gbPricePerKitPhp).toBe(1975);
      expect(product.gbPricePerPiecePhp).toBe(395);
    }
  });

  it('counts five pairs to a pack, matching the catalogue pack size', () => {
    // gbVialsPerKit and kitSize describe the same physical pack. Letting them
    // disagree would price a pair off one number and order it off the other.
    for (const product of series) {
      expect(product.gbVialsPerKit).toBe(product.kitSize);
    }
  });

  it('seeds a hatian counter that fills at exactly one pack', () => {
    for (const product of series) {
      const { totalSlots, minVials, pricePerKitPhp } = kahatiDefaultsFor({
        gbPricePerKitPhp: product.gbPricePerKitPhp ?? null,
        gbPricePerPiecePhp: product.gbPricePerPiecePhp ?? null,
        gbVialsPerKit: product.gbVialsPerKit ?? null,
        gbMinVials: product.gbMinVials ?? null,
        gbMaxVialsPerBatch: product.gbMaxVialsPerBatch ?? null,
      });

      // Five pairs, not the ten-vial default a peptide counter would take.
      expect(totalSlots).toBe(5);
      expect(minVials).toBe(1);
      expect(pricePerKitPhp).toBe(1975);
    }
  });

  it('derives the advertised per-pair price from the pack price', () => {
    for (const product of series) {
      expect(groupBuyUnitPrice({
        gbPricePerKitPhp: product.gbPricePerKitPhp ?? null,
        gbPricePerPiecePhp: null,
        gbVialsPerKit: product.gbVialsPerKit ?? null,
        gbMinVials: null,
        gbMaxVialsPerBatch: null,
      }, 'piece')).toBe(395);
    }
  });
});
