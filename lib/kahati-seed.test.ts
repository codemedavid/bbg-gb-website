// What a Hatian (kahati) counter starts as when it is opened FOR a catalog product.
//
// The mirror of lib/campaign-seed.test.ts, for the other board. Both boards seed
// from the same product columns, so the one thing these tests are really guarding
// is that they cannot drift apart: a kit costs the same whether a customer joins
// a hatian or commits to a Group Buy campaign. The discount is the admin lowering
// one of them afterwards, deliberately.
//
// Where they differ is the counting. A campaign counts KITS, so campaignSeedFor
// converts the product's vial figures. A hatian is vial-native and fills exactly
// one kit, so its figures apply directly — bounded by that cap.
import { describe, it, expect } from 'vitest';
import { kahatiSeedFor } from './kahati-seed';
import type { SeedableProduct } from './campaign-seed';

const product = (o: Partial<SeedableProduct> = {}): SeedableProduct => ({
  id: 'p1',
  name: 'Retatrutide',
  spec: '20mg vial',
  pricePhp: '900.00',
  arrivalGroup: 'white_powder',
  gbPricePerKitPhp: null,
  gbPricePerPiecePhp: null,
  gbVialsPerKit: null,
  gbMinVials: null,
  gbMaxVialsPerBatch: null,
  ...o,
});

describe('kahatiSeedFor', () => {
  it('prices a kit from the group buy price the admin set on the product', () => {
    const seed = kahatiSeedFor(product({ gbPricePerKitPhp: '7500', pricePhp: '900' }));
    expect(seed?.pricePerKitPhp).toBe(7500);
  });

  it('falls back to the shop price as-is, because that price is already per kit', () => {
    const seed = kahatiSeedFor(product({ pricePhp: '900' }));
    expect(seed?.pricePerKitPhp).toBe(900);
  });

  it('does not scale that fallback by the kit size', () => {
    // The bug this whole change exists to kill: ₱900 a kit must never list at ₱9,000.
    expect(kahatiSeedFor(product({ pricePhp: '900', gbVialsPerKit: 10 }))?.pricePerKitPhp).toBe(900);
  });

  it('prices a hatian exactly as the campaign board prices the same product', () => {
    // The two boards must never quote different money for one kit.
    const p = product({ pricePhp: '4850' });
    expect(kahatiSeedFor(p)?.pricePerKitPhp).toBe(4850);
  });

  it('treats a zero group buy price as unset rather than as a free kit', () => {
    const seed = kahatiSeedFor(product({ gbPricePerKitPhp: '0', pricePhp: '900' }));
    expect(seed?.pricePerKitPhp).toBe(900);
  });

  it('refuses to seed a counter it cannot price rather than opening a free one', () => {
    expect(kahatiSeedFor(product({ pricePhp: '0' }))).toBeNull();
    expect(kahatiSeedFor(product({ pricePhp: '-5' }))).toBeNull();
    expect(kahatiSeedFor(product({ pricePhp: 'not a number' }))).toBeNull();
  });

  it('fills exactly one kit by default, because that is what a hatian is', () => {
    const seed = kahatiSeedFor(product());
    expect(seed?.totalSlots).toBe(10);
    expect(seed?.minVials).toBe(1);
  });

  it("takes its cap from the product's batch maximum, never above one kit", () => {
    expect(kahatiSeedFor(product({ gbMaxVialsPerBatch: 6 }))?.totalSlots).toBe(6);
    // 40 vials is four kits; a hatian still holds one.
    expect(kahatiSeedFor(product({ gbMaxVialsPerBatch: 40 }))?.totalSlots).toBe(10);
  });

  it('clamps a per-person minimum that nobody could meet down to the cap', () => {
    // A 9-vial floor on a 6-vial counter would reject every commitment, the
    // first one included — an unjoinable counter is worse than no minimum.
    const seed = kahatiSeedFor(product({ gbMinVials: 9, gbMaxVialsPerBatch: 6 }));
    expect(seed?.minVials).toBe(6);
  });

  it('names the counter after the product and its spec, so the board reads as a product', () => {
    const seed = kahatiSeedFor(product({ name: 'Retatrutide', spec: '20mg vial' }));
    expect(seed?.name).toBe('Retatrutide 20mg vial');
  });

  it('links the product, so the counter is traceable back to the catalog row', () => {
    const seed = kahatiSeedFor(product({ id: 'prod-123' }));
    expect(seed?.productId).toBe('prod-123');
  });

  it('carries the arrival group so the batch ships with its own group', () => {
    expect(kahatiSeedFor(product({ arrivalGroup: 'salt_liquid' }))?.arrivalGroup).toBe('salt_liquid');
  });
});
