// Planning a price adjustment from the client's workbook - pure, no database.
//
// Nothing here writes. It produces a PLAN an admin reads before any money
// changes, because the two ways this goes wrong are both silent: a row matched
// to the wrong product reprices something nobody looked at, and a row matched
// to nothing disappears without ever being applied. Every row therefore comes
// back under exactly one heading, and the totals are meant to be checked.
//
// Matching is delegated to lib/pricelist-match.ts, which matches on name+size
// and never on the workbook code. That is not a preference: the Retatrutide
// block reuses Tirzepatide's BBG1000-** codes at different prices, so a code
// lookup returns the wrong product with full confidence. Production agrees -
// SK10 is two different products.
import { excluded, findMatches, type MatchableProduct, type PricelistRow } from './pricelist-match';

/** One row of the adjustment workbook's FINAL PRICE sheet. */
export type AdjustmentRow = {
  /** 1-based worksheet row, so a report can point at the spreadsheet. */
  row: number;
  name: string;
  size: string | null;
  code: string | null;
  /** The NEW PRICE column - a KIT price, matching products.price_php. */
  php: number;
};

/** A catalog product, reduced to what repricing needs to decide. */
export type PriceableProduct = MatchableProduct & {
  id: string;
  code: string | null;
  pricePhp: number;
  isKahati: boolean;
  isOnHand: boolean;
};

/**
 * One price to change.
 *
 * Carries no on-hand field, and deliberately: on_hand_kit_php and its siblings
 * are a separate entity the client prices separately, so there is no shape in
 * which this plan can express a change to one.
 */
export type PriceUpdate = {
  productId: string;
  name: string;
  spec: string;
  fromPhp: number;
  toPhp: number;
};

export type SkippedProduct = { row: number; productId: string; name: string; why: string };
export type AmbiguousRow = { row: number; name: string; size: string | null; candidates: string[] };
export type UnmatchedRow = { row: number; name: string; size: string | null; code: string | null };

export type PricePlan = {
  /** Prices that will change. */
  updates: PriceUpdate[];
  /** Matched, but already at the workbook's price. */
  unchanged: SkippedProduct[];
  /** Matched only to products the client prices elsewhere. */
  skippedOnHand: SkippedProduct[];
  /** Matched to more than one product - never guessed. */
  ambiguous: AmbiguousRow[];
  /** Matched to nothing in the catalog. */
  unmatched: UnmatchedRow[];
  /** Rows lib/pricelist-match.ts excludes on standing instruction. */
  excluded: { row: number; name: string; why: string }[];
};

// The matcher reads a Pricelist row; an adjustment row is the same identity
// with a different price column, so it is adapted rather than re-implemented.
const asPricelistRow = (r: AdjustmentRow): PricelistRow => ({
  category: '', name: r.name, size: r.size, code: r.code,
  usd: null, php: r.php, block: 'FINAL PRICE', row: r.row,
});

/**
 * What this adjustment would do, said before it does it.
 *
 * A product is repriced only if it is sold as kahati or group buy. One sold
 * only on-hand keeps its price: on-hand is retail off existing stock and the
 * client prices it separately, so moving it off a group-buy sheet would change
 * a number nobody asked to change.
 *
 * Returns new objects throughout and sorts nothing in place.
 */
export function planPriceAdjustment(
  rows: readonly AdjustmentRow[],
  products: readonly PriceableProduct[],
): PricePlan {
  const plan: PricePlan = {
    updates: [], unchanged: [], skippedOnHand: [], ambiguous: [], unmatched: [], excluded: [],
  };

  for (const row of rows) {
    const listRow = asPricelistRow(row);

    const exclusion = excluded(listRow);
    if (exclusion) {
      plan.excluded.push({ row: row.row, name: row.name, why: exclusion.why });
      continue;
    }

    const matches = findMatches(listRow, products);
    if (matches.length === 0) {
      plan.unmatched.push({ row: row.row, name: row.name, size: row.size, code: row.code });
      continue;
    }

    // A product the client prices elsewhere is not a candidate at all, so it is
    // removed BEFORE the ambiguity check: the SK10 pair is one kahati product
    // and one retail one, which is a clear answer rather than a tie.
    const repriceable = matches.filter((p) => p.isKahati || !p.isOnHand);
    const setAside = matches.filter((p) => !repriceable.includes(p));
    for (const p of setAside) {
      plan.skippedOnHand.push({
        row: row.row, productId: p.id, name: p.name,
        why: 'sold on-hand only - priced separately',
      });
    }

    if (repriceable.length === 0) continue;
    if (repriceable.length > 1) {
      plan.ambiguous.push({
        row: row.row, name: row.name, size: row.size,
        candidates: repriceable.map((p) => p.id),
      });
      continue;
    }

    const product = repriceable[0];
    if (product.pricePhp === row.php) {
      plan.unchanged.push({
        row: row.row, productId: product.id, name: product.name,
        why: 'already at the new price',
      });
      continue;
    }

    plan.updates.push({
      productId: product.id, name: product.name, spec: product.spec,
      fromPhp: product.pricePhp, toPhp: row.php,
    });
  }

  return plan;
}
