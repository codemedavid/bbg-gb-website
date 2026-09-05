// What a Group Buy campaign starts as when it is opened FOR a catalog product.
//
// lib/pricing.ts campaignDefaultsFor already converts a product's vial-counted
// terms into a campaign's kit-counted ones. It stops short of one thing: it
// cannot price a product with no group buy price, and returns null rather than
// inventing a figure — an unset price means "not sold this way", never "free".
//
// Every catalog product is in exactly that state, so this module supplies the
// missing rule and nothing else: absent an explicit group buy kit price, a kit
// costs the product's shop price. That is the LIST price, so a seeded campaign
// can never sell below the shop. The group buy discount is the admin lowering
// it afterwards, per product, deliberately.
import { campaignDefaultsFor, seededKitPrice, type GroupBuyConfig } from './pricing';
import type { IncludedProduct, MoqCampaign } from './types';

/** The product fields a seeded campaign reads. */
export type SeedableProduct = GroupBuyConfig & {
  id: string;
  name: string;
  spec: string;
  /** The shop's price for one KIT — the fallback the campaign price falls back to. */
  pricePhp: string | number;
  arrivalGroup: MoqCampaign['arrivalGroup'];
};

/**
 * What a listing for this product is called on either board.
 *
 * Name and spec together, because a board shows the listing name and
 * "Retatrutide" alone does not say which vial the kit holds. Stated once
 * because three callers need the identical string: the two seeders, which name
 * a listing when they open it, and lib/listing-sync.ts, which decides whether a
 * product edit renamed it. A second copy of this format is how a renamed
 * product stops matching its own counter.
 */
export function listingName(p: { name: string; spec: string }): string {
  return `${p.name} ${p.spec}`.trim();
}

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
  const pricePerKitPhp = seededKitPrice(p, p.pricePhp);
  if (pricePerKitPhp == null) return null;

  return {
    name: listingName(p),
    pricePerKitPhp,
    moq: defaults.moq,
    perCustomerMin: defaults.perCustomerMin,
    arrivalGroup: p.arrivalGroup,
    includedProducts: [{ productId: p.id, name: p.name, outOfStock: false }],
  };
}

