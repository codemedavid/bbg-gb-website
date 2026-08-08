// The mapping from a SeedProduct to the row the seeder inserts.
//
// Extracted from scripts/seed.ts so it can be asserted without running a full
// database wipe-and-reseed. Two fields here are load-bearing and were silently
// dropped before the Skin Repair series needed them: `kitSize`, the divisor the
// weekly report's Kits column is built on, and a per-product `description`,
// without which six products that differ only in what they treat all inherit
// one category blurb.
import { describe, it, expect } from 'vitest';
import { seedProductRow } from './seed-rows';
import { CATEGORY_DESC, type SeedProduct } from './catalog';

const CATEGORY_ID = '00000000-0000-4000-8000-000000000001';

const product = (o: Partial<SeedProduct> = {}): SeedProduct => ({
  code: 'X1', name: 'Example', spec: '15mg vial', cat: 'skin',
  pricePhp: 1000, priceUsd: 16, arrival: 'white_powder', ...o,
});

describe('seedProductRow', () => {
  it('carries an explicit pack size through to the row', () => {
    expect(seedProductRow(product({ kitSize: 5 }), CATEGORY_ID).kitSize).toBe(5);
  });

  it('defaults an unstated pack size to the ten-vial peptide kit', () => {
    // The column's own default. Stating it here keeps the seeded value and the
    // schema default from drifting apart unnoticed.
    expect(seedProductRow(product(), CATEGORY_ID).kitSize).toBe(10);
  });

  it('prefers a product description over the category blurb', () => {
    const row = seedProductRow(product({ description: 'Fades dark spots.' }), CATEGORY_ID);

    expect(row.description).toBe('Fades dark spots.');
  });

  it('falls back to the category blurb when a product states none', () => {
    expect(seedProductRow(product(), CATEGORY_ID).description).toBe(CATEGORY_DESC.skin);
  });

  it('writes money as strings, as the numeric columns require', () => {
    // A raw JS number reaches the driver as a float and loses scale on a
    // numeric(12,2) column.
    const row = seedProductRow(product({ pricePhp: 1975, priceUsd: null }), CATEGORY_ID);

    expect(row.pricePhp).toBe('1975');
    expect(row.priceUsd).toBeNull();
  });

  it('keeps the on-hand fields null when a product is not ready stock', () => {
    const row = seedProductRow(product(), CATEGORY_ID);

    expect(row.isOnHand).toBe(false);
    expect(row.onHandKitPhp).toBeNull();
    expect(row.onHandPiecePhp).toBeNull();
  });

  it('carries on-hand pricing through when a product is ready stock', () => {
    const row = seedProductRow(
      product({ isOnHand: true, onHandKitPhp: 5000, onHandPiecePhp: 550 }),
      CATEGORY_ID,
    );

    expect(row).toMatchObject({ isOnHand: true, onHandKitPhp: '5000', onHandPiecePhp: '550' });
  });
});

describe('seedProductRow — group buy terms', () => {
  it('leaves a product off the boards and states no terms by default', () => {
    // Null, not 0: null is "states no figure of its own" and falls back to the
    // global defaults. A ₱0 group buy price would read as free.
    const row = seedProductRow(product(), CATEGORY_ID);

    expect(row.isGroupBuy).toBe(false);
    expect(row.gbPricePerKitPhp).toBeNull();
    expect(row.gbVialsPerKit).toBeNull();
    expect(row.gbMinVials).toBeNull();
    expect(row.gbMaxVialsPerBatch).toBeNull();
  });

  it('carries stated group buy terms through, money as strings', () => {
    const row = seedProductRow(product({
      isGroupBuy: true, gbPricePerKitPhp: 1975, gbPricePerPiecePhp: 395,
      gbVialsPerKit: 5, gbMinVials: 1, gbMaxVialsPerBatch: 5,
    }), CATEGORY_ID);

    expect(row).toMatchObject({
      isGroupBuy: true, gbPricePerKitPhp: '1975', gbPricePerPiecePhp: '395',
      gbVialsPerKit: 5, gbMinVials: 1, gbMaxVialsPerBatch: 5,
    });
  });
});

describe('seedProductRow — the Kahati channel', () => {
  it('leaves an aesthetics product off Kahati while keeping it on Group Buy', () => {
    // Mirrors drizzle/0019_product_sales_channels.sql. A fresh seed and a
    // migrated production database must agree on what a hatian may be opened
    // for, or a local environment quietly disagrees about what is for sale.
    const row = seedProductRow(
      { code: null, name: 'Rejuran i', spec: '1 prefilled syringe, 1ml', cat: 'aesthetics',
        pricePhp: 12000, arrival: 'salt_liquid', isGroupBuy: true },
      'cat-aesthetics',
    );

    expect(row.isKahati).toBe(false);
    expect(row.isGroupBuy).toBe(true);
  });

  it('gives an ordinary group-buy peptide both board channels', () => {
    const row = seedProductRow(
      { code: 'BBG-RETA', name: 'Retatrutide', spec: '20mg vial', cat: 'glp-1',
        pricePhp: 9000, arrival: 'white_powder', isGroupBuy: true },
      'cat-glp1',
    );

    expect(row.isKahati).toBe(true);
    expect(row.isGroupBuy).toBe(true);
  });

  it('gives no board channel to a product that is not offered through group buy', () => {
    // Kahati is not implied by the catalogue: an on-hand-only product has no
    // counter, and the seed must not invent one.
    const row = seedProductRow(
      { code: 'BAC-3', name: 'BAC Water', spec: '3ml', cat: 'bac',
        pricePhp: 475, arrival: 'white_powder' },
      'cat-bac',
    );

    expect(row.isKahati).toBe(false);
    expect(row.isGroupBuy).toBe(false);
  });
})
