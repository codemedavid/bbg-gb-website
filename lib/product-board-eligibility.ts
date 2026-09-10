// Which catalog rows the two boards may carry — pure rule, no I/O.
//
// `is_group_buy` and `is_kahati` are a per-product permission an admin ticks on
// the product form (lib/product-channels.ts). The catalog reached 164 active
// products with those switches set by hand, one at a time, and most of them
// were never reached — which is what left the boards carrying 94 of 164
// products while the shop sold all of them.
//
// This is the rule that ticks the rest, and it is deliberately the HATIAN's own
// shape rather than a category list. A counter splits ONE SUPPLIER KIT ten
// ways. So a product qualifies when its kit really does hold ten vials, and it
// can be priced. A Rejuran i is one prefilled syringe; a REJURAN Silver Ampoule
// is one 30ml bottle; a sheet of vial stickers is packaging. None has ten of
// anything to share, and a counter over one promises a per-vial share of
// something with no vials — the exact failure the channel switches were
// introduced to express.
//
// Note what is NOT here: no category test. An earlier version of this idea was
// a hardcoded `is_korean` flag, and lib/product-channels.ts records why that
// was removed. The intrinsic figures — kit size, vials per kit, price — say the
// same thing without freezing a category name into code, and they keep saying
// it when next month's filler arrives under a category nobody has invented yet.
// The one name-shaped exception is the packaging rows below, which carry a
// peptide's kit size but are not product.
//
// A row this rule refuses is not thereby refused forever: the switches stay
// admin-editable, and ticking one by hand still overrides everything here. The
// rule decides the BACKFILL, not the policy.
import { seededKitPrice, VIALS_PER_KIT, type GroupBuyPricing } from './pricing';

/** The least a catalog row must carry to be judged. */
export type BoardCandidate = GroupBuyPricing & {
  name: string;
  /** Vials per supplier kit — how the product SHIPS (lib/db/schema.ts). */
  kitSize: number;
  /** The shop's per-kit price, the fallback a board price falls back to. */
  pricePhp: string | number | null;
};

// Packaging sold through the catalog so it can be added to an order: vial
// stickers at ₱5, carrying a peptide's kit_size because they are ordered by the
// sheet. They are not a kit anybody splits, and a hatian counter over one would
// put ten people on ₱5 of stickers.
const ACCESSORY_PATTERN = /holographic\s+sticker/i;

/** True for the packaging rows, whatever their kit size claims. */
export function isAccessory(name: string): boolean {
  return ACCESSORY_PATTERN.test(name);
}

/**
 * May both boards carry this product?
 *
 * Deliberately silent about `is_active`: that column governs whether the SHOP
 * lists the product, and both seeders already refuse a delisted one
 * (lib/kahati-seed-bulk.ts, lib/campaign-seed-bulk.ts). This answers the other
 * question — whether the product is the SHAPE a board can carry — which is true
 * or false whether or not it is on sale today. Keeping them apart is what lets
 * a relisted product go straight back onto both boards instead of waiting for
 * someone to remember to run the backfill again.
 */
export function isBoardEligible(p: BoardCandidate): boolean {
  if (isAccessory(p.name)) return false;

  // How the supplier ships it, and how the product says its kit divides. Both
  // must say ten: kit_size alone is stale on rows imported before the group buy
  // columns existed, and gb_vials_per_kit alone is absent on most of the
  // catalog. An explicit figure that disagrees with ten — 1 on a serum, 110
  // from a typo — refuses rather than being rounded into agreement.
  if (p.kitSize !== VIALS_PER_KIT) return false;
  if (p.gbVialsPerKit != null && p.gbVialsPerKit !== VIALS_PER_KIT) return false;

  // The same test both seeders apply before opening a listing. A product they
  // would refuse to price must not have its switch ticked either — that would
  // only move the gap from "absent from the board" to "skipped, unpriced" on
  // every board read from now on.
  return seededKitPrice(p, p.pricePhp) != null;
}
