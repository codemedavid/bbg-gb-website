// Pushing a catalog edit onto the listings already on the boards — pure rules, no I/O.
//
// A listing seeds its terms from its product ONCE, when it is opened
// (lib/kahati-seed.ts, lib/campaign-seed.ts). Nothing carried a later edit
// across, so product management and the two boards drifted apart the moment an
// admin corrected a price: the catalog said ₱4,000, every open counter still
// charged ₱4,800, and the only way to close the gap was to end the batch. This
// module is the missing half of that link — the product is the authority, and
// an edit to it reaches the listings it already opened.
//
// Two rules shape every patch below.
//
// It pushes what the edit CHANGED, not the product's full terms. A counter may
// carry a discount an admin typed into it by hand; renaming the product must
// not silently undo that. So each field travels only when the product's own
// derived value for it moved — which also makes an edit to stock, a COA or a
// description a no-op on both boards rather than a surprise repricing.
//
// And a patch may never make a listing invalid. Counts are clamped to what has
// already been claimed or committed: `group_buys_claimed_within_cap` forbids
// 6/3 outright, and a per-person floor above the cap would reject every
// commitment including the first. A listing narrows as far as the people
// already in it allow, and no further.
import { campaignDefaultsFor, kahatiDefaultsFor, seededKitPrice } from './pricing';
import { listingName, type SeedableProduct } from './campaign-seed';
import type { IncludedProduct, MoqCampaign } from './types';

type ArrivalGroup = MoqCampaign['arrivalGroup'];

/** The columns of an open hatian counter a product edit can move. */
export type KahatiListingRow = { totalSlots: number; claimedSlots: number; minVials: number };

export type KahatiListingPatch = {
  name?: string;
  pricePerKitPhp?: string;
  totalSlots?: number;
  minVials?: number;
  arrivalGroup?: ArrivalGroup;
};

/** The columns of an open campaign batch a product edit can move. */
export type CampaignListingRow = {
  moq: number; committed: number; perCustomerMin: number; includedProducts: IncludedProduct[];
};

export type CampaignListingPatch = {
  name?: string;
  pricePerKitPhp?: string;
  moq?: number;
  perCustomerMin?: number;
  arrivalGroup?: ArrivalGroup;
  includedProducts?: IncludedProduct[];
};

// What the two boards derive from a product, read through the very functions
// that seed a NEW listing. Going through kahatiDefaultsFor / campaignDefaultsFor
// / seededKitPrice rather than reading the columns directly is what keeps an
// edited listing and a freshly seeded one landing on the same figures.
type KahatiDerived = {
  name: string; pricePerKitPhp: number | null; totalSlots: number; minVials: number;
  arrivalGroup: ArrivalGroup;
};

function kahatiDerived(p: SeedableProduct): KahatiDerived {
  const defaults = kahatiDefaultsFor(p);
  return {
    name: listingName(p),
    pricePerKitPhp: seededKitPrice(p, p.pricePhp),
    totalSlots: defaults.totalSlots,
    minVials: defaults.minVials,
    arrivalGroup: p.arrivalGroup,
  };
}

type CampaignDerived = {
  name: string; pricePerKitPhp: number | null; moq: number; perCustomerMin: number;
  arrivalGroup: ArrivalGroup;
};

function campaignDerived(p: SeedableProduct): CampaignDerived {
  const defaults = campaignDefaultsFor(p);
  return {
    name: listingName(p),
    pricePerKitPhp: seededKitPrice(p, p.pricePhp),
    moq: defaults.moq,
    perCustomerMin: defaults.perCustomerMin,
    arrivalGroup: p.arrivalGroup,
  };
}

// A price that moved AND can still be charged. An edit that leaves a product
// unpriceable — a blanked group buy price over a ₱0 shop price — pushes
// nothing: seededKitPrice already refuses to open a counter it cannot price,
// and a listing that silently drops to ₱0 is a free kit on a public board.
function repricedTo(before: number | null, after: number | null): string | undefined {
  if (after == null || after === before) return undefined;
  return String(after);
}

/** Whether a patch would write anything, so callers can skip a no-op UPDATE. */
export function hasListingChanges(patch: KahatiListingPatch | CampaignListingPatch): boolean {
  return Object.keys(patch).length > 0;
}

/**
 * What this product edit changes about one OPEN hatian counter.
 *
 * `row` is the counter as stored, which is what the clamps are measured
 * against: the cap cannot fall below the vials already claimed, and the
 * per-person minimum cannot rise above the cap the same edit is setting.
 */
export function kahatiListingPatch(
  before: SeedableProduct,
  after: SeedableProduct,
  row: KahatiListingRow,
): KahatiListingPatch {
  const b = kahatiDerived(before);
  const a = kahatiDerived(after);
  const patch: KahatiListingPatch = {};

  if (a.name !== b.name) patch.name = a.name;

  const pricePerKitPhp = repricedTo(b.pricePerKitPhp, a.pricePerKitPhp);
  if (pricePerKitPhp !== undefined) patch.pricePerKitPhp = pricePerKitPhp;

  if (a.totalSlots !== b.totalSlots) {
    const totalSlots = Math.max(a.totalSlots, row.claimedSlots);
    if (totalSlots !== row.totalSlots) patch.totalSlots = totalSlots;
  }

  // The cap this counter will have once the patch lands — the new one when the
  // edit moved it, otherwise the stored one.
  const cap = patch.totalSlots ?? row.totalSlots;
  if (a.minVials !== b.minVials) {
    patch.minVials = Math.min(a.minVials, cap);
  } else if (row.minVials > cap) {
    // The product's own minimum did not move, but a shrinking cap has stranded
    // the counter's above it. A floor nobody can meet rejects every commitment,
    // so the cap drags it down.
    patch.minVials = cap;
  }

  if (a.arrivalGroup !== b.arrivalGroup) patch.arrivalGroup = a.arrivalGroup;

  return patch;
}

/**
 * What this product edit changes about one OPEN campaign batch.
 *
 * A batch that carries other products too keeps its name, price and counts: one
 * product of several cannot speak for the batch, and repricing a mixed batch
 * from one of its members is how a campaign ends up charging for the wrong
 * thing. Its own label in `included_products` is still its own, so that is
 * refreshed either way.
 */
export function campaignListingPatch(
  before: SeedableProduct,
  after: SeedableProduct,
  row: CampaignListingRow,
): CampaignListingPatch {
  const b = campaignDerived(before);
  const a = campaignDerived(after);
  const patch: CampaignListingPatch = {};

  if (after.name !== before.name) {
    const includedProducts = row.includedProducts.map((p) => (
      p.productId === after.id ? { ...p, name: after.name } : p
    ));
    // Only when this batch actually carries the product; a caller handing over a
    // batch that does not gets no relabelling out of it.
    if (includedProducts.some((p) => p.productId === after.id)) {
      patch.includedProducts = includedProducts;
    }
  }

  const carriesOnlyThis = row.includedProducts.length === 1
    && row.includedProducts[0]?.productId === after.id;
  if (!carriesOnlyThis) return patch;

  if (a.name !== b.name) patch.name = a.name;

  const pricePerKitPhp = repricedTo(b.pricePerKitPhp, a.pricePerKitPhp);
  if (pricePerKitPhp !== undefined) patch.pricePerKitPhp = pricePerKitPhp;

  if (a.moq !== b.moq) {
    const moq = Math.max(a.moq, row.committed);
    if (moq !== row.moq) patch.moq = moq;
  }

  const capacity = patch.moq ?? row.moq;
  if (a.perCustomerMin !== b.perCustomerMin) {
    patch.perCustomerMin = Math.min(a.perCustomerMin, capacity);
  } else if (row.perCustomerMin > capacity) {
    patch.perCustomerMin = capacity;
  }

  if (a.arrivalGroup !== b.arrivalGroup) patch.arrivalGroup = a.arrivalGroup;

  return patch;
}
