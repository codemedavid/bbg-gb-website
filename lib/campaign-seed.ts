// What a Group Buy campaign starts as when it is opened FOR a catalog product.
//
// lib/pricing.ts campaignDefaultsFor already converts a product's vial-counted
// terms into a campaign's kit-counted ones. It stops short of one thing: it
// cannot price a product with no group buy price, and returns null rather than
// inventing a figure — an unset price means "not sold this way", never "free".
//
// Every catalog product is in exactly that state, so this module supplies the
// missing rule and nothing else: absent an explicit group buy kit price, a kit
// costs what its vials cost in the shop. That is the LIST price, so a seeded
// campaign can never sell below the shop. The group buy discount is the admin
// lowering it afterwards, per product, deliberately.
import { campaignDefaultsFor, groupBuyVialsPerKit, round2, type GroupBuyConfig } from './pricing';
import type { IncludedProduct, MoqCampaign } from './types';

/** The product fields a seeded campaign reads. */
export type SeedableProduct = GroupBuyConfig & {
  id: string;
  name: string;
  spec: string;
  /** The shop's price for one vial — the fallback the kit price is built from. */
  pricePhp: string | number;
  arrivalGroup: MoqCampaign['arrivalGroup'];
};

/** A campaign about to be opened. Mirrors the columns POST /api/campaigns writes. */
export type CampaignSeed = {
  name: string;
  pricePerKitPhp: number;
  moq: number;
  perCustomerMin: number;
  arrivalGroup: MoqCampaign['arrivalGroup'];
  includedProducts: IncludedProduct[];
};

/**
 * The campaign to open for this product, or null when it cannot be priced.
 *
 * Null is a refusal, not an error: a product with no group buy price and no
 * usable shop price would seed a ₱0 kit, and a free kit on the board is worse
 * than an absent one. The caller reports the skip so the gap is visible.
 */
export function campaignSeedFor(p: SeedableProduct): CampaignSeed | null {
  const defaults = campaignDefaultsFor(p);
  const pricePerKitPhp = defaults.pricePerKitPhp ?? shopKitPrice(p);
  if (pricePerKitPhp == null) return null;

  return {
    // Name and spec together, because the board shows the campaign name and
    // "Retatrutide" alone does not say which vial the kit holds.
    name: `${p.name} ${p.spec}`.trim(),
    pricePerKitPhp,
    moq: defaults.moq,
    perCustomerMin: defaults.perCustomerMin,
    arrivalGroup: p.arrivalGroup,
    includedProducts: [{ productId: p.id, name: p.name, outOfStock: false }],
  };
}

// A kit at shop prices: one vial's price times the vials in this product's kit.
// Zero, negative and unparseable prices yield null for the same reason
// positiveMoney does it in lib/pricing.ts — they mean "no price", not "free".
function shopKitPrice(p: SeedableProduct): number | null {
  const perVial = Number(p.pricePhp);
  if (!Number.isFinite(perVial) || perVial <= 0) return null;
  return round2(perVial * groupBuyVialsPerKit(p));
}
