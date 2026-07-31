// What a Group Buy campaign starts as when it is opened FOR a catalog product.
//
// campaignDefaultsFor already converts a product's vial-counted terms into a
// campaign's kit-counted ones. What it cannot do is price a product that has no
// group buy price: it returns null, because an unset price means "not sold this
// way" and never "free". Every one of the 95 catalog products is in exactly that
// state, which is why flagging them all changed nothing a customer could see.
//
// This module closes that gap with one rule: absent an explicit group buy kit
// price, a kit costs what its vials cost in the shop. That is the list price, so
// it can never sell below cost — the discount is the admin lowering it later,
// deliberately, per product.
import { describe, it, expect } from 'vitest';
import { campaignSeedFor, type SeedableProduct } from './campaign-seed';

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

describe('campaignSeedFor', () => {
  it('prices a kit from the group buy price the admin set on the product', () => {
    const seed = campaignSeedFor(product({ gbPricePerKitPhp: '7500', pricePhp: '900' }));
    expect(seed?.pricePerKitPhp).toBe(7500);
  });

  it('falls back to the shop price times the kit size when no group buy price is set', () => {
    // 900 a vial, ten vials to a kit — the list price of the same goods.
    const seed = campaignSeedFor(product({ pricePhp: '900' }));
    expect(seed?.pricePerKitPhp).toBe(9000);
  });

  it("uses the product's own kit size for that fallback, not the global ten", () => {
    const seed = campaignSeedFor(product({ pricePhp: '900', gbVialsPerKit: 5 }));
    expect(seed?.pricePerKitPhp).toBe(4500);
  });

  it('treats a zero group buy price as unset rather than as a free kit', () => {
    const seed = campaignSeedFor(product({ gbPricePerKitPhp: '0', pricePhp: '900' }));
    expect(seed?.pricePerKitPhp).toBe(9000);
  });

  it('rounds a fractional shop price to centavos', () => {
    const seed = campaignSeedFor(product({ pricePhp: '3062.505' }));
    expect(seed?.pricePerKitPhp).toBe(30625.05);
  });

  it('refuses to seed a campaign it cannot price rather than opening a free one', () => {
    expect(campaignSeedFor(product({ pricePhp: '0' }))).toBeNull();
    expect(campaignSeedFor(product({ pricePhp: '-5' }))).toBeNull();
    expect(campaignSeedFor(product({ pricePhp: 'not a number' }))).toBeNull();
  });

  it('names the campaign after the product and its spec, so the board reads as a product', () => {
    const seed = campaignSeedFor(product({ name: 'Retatrutide', spec: '20mg vial' }));
    expect(seed?.name).toBe('Retatrutide 20mg vial');
  });

  it('carries the product in includedProducts, in stock', () => {
    const seed = campaignSeedFor(product({ id: 'prod-123', name: 'Retatrutide' }));
    expect(seed?.includedProducts).toEqual([
      { productId: 'prod-123', name: 'Retatrutide', outOfStock: false },
    ]);
  });

  it('takes its batch size and per-customer minimum from the product terms', () => {
    // 40 vials a batch at 10 to a kit is 4 kits; a 15-vial minimum is 2 kits
    // once rounded up, because a customer commits whole kits.
    const seed = campaignSeedFor(product({ gbMaxVialsPerBatch: 40, gbMinVials: 15 }));
    expect(seed?.moq).toBe(4);
    expect(seed?.perCustomerMin).toBe(2);
  });

  it('defaults to a full batch and a one-kit minimum when the product sets no terms', () => {
    const seed = campaignSeedFor(product());
    expect(seed?.moq).toBe(10);
    expect(seed?.perCustomerMin).toBe(1);
  });

  it('carries the arrival group so the batch ships with its own group', () => {
    const seed = campaignSeedFor(product({ arrivalGroup: 'salt_liquid' }));
    expect(seed?.arrivalGroup).toBe('salt_liquid');
  });
});
