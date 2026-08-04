// The wire contract for a campaign's included products.
//
// An entry now carries the group buy terms the admin set for that product in
// that campaign — price per kit and per piece, the minimum a customer must
// order, the batch size, and how many vials fill a kit. The bounds live here
// rather than only in the admin form so a hand-written PATCH cannot install a
// batch size the batching code refuses to honour.
import { describe, it, expect } from 'vitest';
import { includedProductSchema, moqCampaignSchema } from './moq-schemas';
import { MOQ_BATCH_MAX_KITS } from './pricing';

const PRODUCT_ID = '11111111-2222-3333-4444-555555555555';
const base = { productId: PRODUCT_ID, name: 'Retatrutide 20mg' };

describe('includedProductSchema', () => {
  it('accepts an entry with no terms — the product keeps its own defaults', () => {
    expect(includedProductSchema.parse(base)).toEqual(base);
  });

  it('accepts the full set of per-campaign terms', () => {
    const entry = {
      ...base,
      outOfStock: false,
      pricePerKitPhp: 8500,
      pricePerPiecePhp: 900,
      minOrderQty: 2,
      maxBatchKits: 8,
      vialsPerKit: 10,
    };
    expect(includedProductSchema.parse(entry)).toEqual(entry);
  });

  it('rejects a negative price per kit', () => {
    expect(includedProductSchema.safeParse({ ...base, pricePerKitPhp: -1 }).success).toBe(false);
  });

  it('rejects a negative price per piece', () => {
    expect(includedProductSchema.safeParse({ ...base, pricePerPiecePhp: -1 }).success).toBe(false);
  });

  it('rejects a minimum order of zero — a customer who orders nothing has not joined', () => {
    expect(includedProductSchema.safeParse({ ...base, minOrderQty: 0 }).success).toBe(false);
  });

  it('rejects a fractional minimum order', () => {
    expect(includedProductSchema.safeParse({ ...base, minOrderQty: 1.5 }).success).toBe(false);
  });

  it(`rejects a batch size above the ${MOQ_BATCH_MAX_KITS}-kit cap`, () => {
    expect(includedProductSchema.safeParse({ ...base, maxBatchKits: MOQ_BATCH_MAX_KITS + 1 }).success).toBe(false);
  });

  it('accepts a batch size exactly at the cap', () => {
    expect(includedProductSchema.safeParse({ ...base, maxBatchKits: MOQ_BATCH_MAX_KITS }).success).toBe(true);
  });

  it('rejects a kit that holds no vials', () => {
    expect(includedProductSchema.safeParse({ ...base, vialsPerKit: 0 }).success).toBe(false);
  });
});
