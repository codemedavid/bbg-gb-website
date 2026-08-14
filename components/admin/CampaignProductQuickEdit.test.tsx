// Where a product's saved Group Buy settings actually get used.
//
// The client's rule for the catalog section is that those five settings "will
// automatically be used whenever that product is included in a Group Buy
// campaign". This modal is the whenever: it opens seeded from the product and
// the admin overrides only what differs for this campaign.
//
// The seeding read five fields — groupBuyKitPhp, groupBuyPiecePhp,
// groupBuyMinOrder, groupBuyMaxBatch, vialsPerKit — that exist on no Product
// anywhere in the codebase, so the file did not compile and every seeded draft
// would have come back blank. These tests pin the seeding to the names the
// database and lib/pricing.ts actually use.
import { describe, it, expect } from 'vitest';
import { draftFor, entryFrom, validateDraft } from './CampaignProductQuickEdit';
import type { IncludedProduct, Product } from '@/lib/types';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1', code: 'RETA', name: 'Retatrutide', spec: '10mg',
  pricePhp: '3200', priceUsd: null,
  categoryId: null, categorySlug: null, categoryName: null,
  isOnHand: false, onHandKitPhp: null, onHandPiecePhp: null,
  stock: 5, kitSize: 10, arrivalGroup: 'white_powder', description: null, imageEmoji: '💧',
  soldCount: 0, isActive: true,
  isGroupBuy: true,
  gbPricePerKitPhp: '4500', gbPricePerPiecePhp: '480',
  gbVialsPerKit: 10, gbMinVials: 2, gbMaxVialsPerBatch: 8,
  ...overrides,
});

describe('draftFor — seeding from the product', () => {
  it('opens a newly included product at its own saved settings', () => {
    expect(draftFor(product(), null)).toEqual({
      pricePerKitPhp: '4500',
      pricePerPiecePhp: '480',
      minOrderQty: '2',
      maxBatchKits: '8',
      vialsPerKit: '10',
      outOfStock: false,
    });
  });

  it('leaves a field blank when the product never set one', () => {
    const d = draftFor(product({ gbPricePerPiecePhp: null, gbMinVials: null }), null);

    // Blank, not '0'. An admin must be able to tell "nothing agreed" from
    // "agreed at zero", and the entry drops blanks rather than sending them.
    expect(d.pricePerPiecePhp).toBe('');
    expect(d.minOrderQty).toBe('');
  });

  it('prefers what this campaign already agreed over the product default', () => {
    // Terms are snapshotted into the campaign when the admin saves them. Editing
    // the catalog later must not move a campaign customers have joined.
    const entry: IncludedProduct = { productId: 'p1', name: 'Retatrutide', pricePerKitPhp: 5200 };

    const d = draftFor(product(), entry);

    expect(d.pricePerKitPhp).toBe('5200');
    // Untouched terms still fall through to the product.
    expect(d.vialsPerKit).toBe('10');
  });
});

describe('entryFrom — what the campaign stores', () => {
  it('records the seeded terms against the product', () => {
    const entry = entryFrom(product(), draftFor(product(), null));

    expect(entry).toEqual({
      productId: 'p1', name: 'Retatrutide', outOfStock: false,
      pricePerKitPhp: 4500, pricePerPiecePhp: 480,
      minOrderQty: 2, maxBatchKits: 8, vialsPerKit: 10,
    });
  });

  it('drops a cleared field instead of writing zero', () => {
    const entry = entryFrom(product(), { ...draftFor(product(), null), pricePerPiecePhp: '' });

    expect('pricePerPiecePhp' in entry).toBe(false);
  });
});

describe('validateDraft', () => {
  it('accepts a draft seeded straight from a product', () => {
    expect(validateDraft(draftFor(product(), null))).toBeNull();
  });

  it('rejects a negative price and a fractional kit count', () => {
    const d = draftFor(product(), null);

    expect(validateDraft({ ...d, pricePerKitPhp: '-1' })).toMatch(/negative/i);
    expect(validateDraft({ ...d, vialsPerKit: '2.5' })).toMatch(/whole number/i);
  });
});
