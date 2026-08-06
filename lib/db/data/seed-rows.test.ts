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
