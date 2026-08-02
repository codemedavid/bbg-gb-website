// What a Group Buy campaign starts as when it is opened FOR a catalog product.
//
// campaignDefaultsFor already converts a product's vial-counted terms into a
// campaign's kit-counted ones. What it cannot do is price a product that has no
// group buy price: it returns null, because an unset price means "not sold this
// way" and never "free". Every one of the 95 catalog products is in exactly that
// state, which is why flagging them all changed nothing a customer could see.
//
// This module closes that gap with one rule: absent an explicit group buy kit
// price, a kit costs the product's shop price — which is ALREADY a kit price.
// The source workbook's money column is headed "PER KIT (10 VIALS) PRICE" (see
// HEADER_LABELS in scripts/extract-pricelist.py), so products.price_php holds
// what ten vials cost, not one. Multiplying it by the kit size would list every
// seeded campaign at ten times its price. That shop figure is the list price, so
// a seeded campaign can never sell below the shop — the discount is the admin
// lowering it later, deliberately, per product.
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

  it('falls back to the shop price as-is, because that price is already per kit', () => {
    // ₱900 is what a kit of this product costs in the shop, not what one vial
    // costs. Scaling it by the kit size would list the campaign at ₱9,000.
    const seed = campaignSeedFor(product({ pricePhp: '900' }));
    expect(seed?.pricePerKitPhp).toBe(900);
  });

  it('does not scale that fallback by the kit size, whatever the kit size is', () => {
    // The shop price is per kit regardless of how many vials that kit holds, so
    // a 5-vial kit and a 10-vial kit both seed at the shop's own figure.
    expect(campaignSeedFor(product({ pricePhp: '900', gbVialsPerKit: 5 }))?.pricePerKitPhp).toBe(900);
    expect(campaignSeedFor(product({ pricePhp: '900', gbVialsPerKit: 10 }))?.pricePerKitPhp).toBe(900);
  });

  it('treats a zero group buy price as unset rather than as a free kit', () => {
    const seed = campaignSeedFor(product({ gbPricePerKitPhp: '0', pricePhp: '900' }));
    expect(seed?.pricePerKitPhp).toBe(900);
  });

  it('rounds a fractional shop price to centavos', () => {
    const seed = campaignSeedFor(product({ pricePhp: '3062.505' }));
    expect(seed?.pricePerKitPhp).toBe(3062.51);
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
