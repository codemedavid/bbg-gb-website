// What a Hatian (kahati) counter starts as when it is opened FOR a catalog product.
//
// The mirror of lib/campaign-seed.ts, for the other board. Both read the same
// product columns and both price through seededKitPrice, which is what keeps a
// kit costing the same money whichever board a customer joins from.
//
// The two boards differ only in what they COUNT. A campaign counts kits, so
// campaignDefaultsFor converts the product's vial figures into kit figures. A
// hatian is vial-native — it fills exactly one kit — so kahatiDefaultsFor
// applies them directly, bounded by that cap.
import { kahatiDefaultsFor, seededKitPrice } from './pricing';
import type { SeedableProduct } from './campaign-seed';
import type { MoqCampaign } from './types';

/** A hatian counter about to be opened. Mirrors the columns POST /api/admin/groupbuys writes. */
export type KahatiSeed = {
  name: string;
  productId: string;
  pricePerKitPhp: number;
  totalSlots: number;
  minVials: number;
  arrivalGroup: MoqCampaign['arrivalGroup'];
};

/**
 * The counter to open for this product, or null when it cannot be priced.
 *
 * Null is a refusal, not an error — the same one campaignSeedFor makes. A
 * counter with no usable price would fill ten vials at ₱0, and a free kit on
 * the board is worse than an absent one. The caller reports the skip so the
 * gap stays visible.
 */
export function kahatiSeedFor(p: SeedableProduct): KahatiSeed | null {
  const pricePerKitPhp = seededKitPrice(p, p.pricePhp);
  if (pricePerKitPhp == null) return null;

  const defaults = kahatiDefaultsFor(p);
  return {
    // Name and spec together, matching the campaign board — "Retatrutide" alone
    // does not say which vial the kit holds.
    name: `${p.name} ${p.spec}`.trim(),
    productId: p.id,
    pricePerKitPhp,
    totalSlots: defaults.totalSlots,
    minVials: defaults.minVials,
    arrivalGroup: p.arrivalGroup,
  };
}
