// Ticking both board switches across the catalog — database side.
//
// lib/product-group-buy-bulk.ts opened ONE switch on EVERY row, which was the
// right operation for the day the campaign board had nothing on it at all. It
// is the wrong one now: the catalog has grown fillers, serums and packaging
// that no hatian can split, and turning their switches on would put a ten-vial
// counter over a single prefilled syringe.
//
// So this one is selective. lib/product-board-eligibility.ts decides WHICH rows
// qualify — by the hatian's own shape, not by category — and this module does
// the writing. Between them they are the operation that closes the gap the shop
// actually had: 164 products on sale, 94 of them on the boards.
//
// It writes the two switches and nothing else. Every gb_* column stays as it
// is: they are nullable, and null means "not configured", which falls back to
// the global defaults in lib/pricing.ts. Writing zeros there instead would read
// as a free kit (see lib/db/schema.ts).
//
// Nothing lists as a result of this alone. The switch is a permission; the
// listings are opened by lib/kahati-seed-bulk.ts and lib/campaign-seed-bulk.ts,
// which both boards run on read.
import { eq } from 'drizzle-orm';
import { getDb, products } from '@/lib/db';
import { isBoardEligible } from './product-board-eligibility';
import { listingName } from './campaign-seed';

/** What a run did, or — under `dryRun` — what a run would do. */
export type OpenBoardsReport = {
  /** Products in the catalog, delisted ones included. */
  scanned: number;
  /** Products whose kit splits ten ways and can be priced. */
  eligible: number;
  /** Eligible products whose Kahati switch was off: ticked, or awaiting a real run. */
  kahatiOpened: number;
  /** Eligible products whose Group Buy switch was off. */
  groupBuyOpened: number;
  /**
   * Rows refused for want of a usable price, named so the gap stays visible.
   *
   * These are the near misses — a ten-vial kit sitting at ₱0 — and they are the
   * ones worth a human's attention, because the fix is a price rather than a
   * decision. Rows refused for their SHAPE are not named: a filler is not a gap.
   */
  skippedUnpriced: string[];
  /** False when `dryRun` held the write back. */
  applied: boolean;
};

/**
 * Opens both boards to every product the eligibility rule accepts.
 *
 * Idempotent, and one-directional: it only ever ticks a switch ON. A product an
 * admin has deliberately taken off a board stays off until this is run again,
 * which is a decision rather than an accident — and a switch the rule would not
 * have ticked is left exactly as it was found, so the sticker rows keep the
 * Group Buy someone gave them by hand.
 *
 * The two switches are counted and written separately because they are
 * independent (lib/product-channels.ts): a product can already be on the
 * campaign board and still be missing from the hatian one, which is precisely
 * the state most of the catalog was in.
 */
export async function openBoardsForVialProducts(
  opts: { dryRun?: boolean } = {},
): Promise<OpenBoardsReport> {
  const db = await getDb();

  const rows = await db.select().from(products);
  const eligible = rows.filter(isBoardEligible);

  // Named only when the row was a ten-vial kit that simply had no price — the
  // shape was right and the money was missing. isBoardEligible bundles both
  // refusals, so the price test is re-asked here to tell them apart.
  const skippedUnpriced = rows
    .filter((p) => !isBoardEligible(p) && isBoardEligible({ ...p, pricePhp: '1' }))
    .map((p) => listingName(p));

  const kahatiPending = eligible.filter((p) => !p.isKahati);
  const groupBuyPending = eligible.filter((p) => !p.isGroupBuy);

  const report = {
    scanned: rows.length,
    eligible: eligible.length,
    kahatiOpened: kahatiPending.length,
    groupBuyOpened: groupBuyPending.length,
    skippedUnpriced,
  };

  if (opts.dryRun) return { ...report, applied: false };

  // Row by row rather than one UPDATE over an id list: the eligibility rule
  // lives in JavaScript — it reads kit size, vials per kit and a price fallback
  // together — so there is no WHERE that expresses it, and a hand-written
  // predicate per driver is the second copy of the rule that goes stale.
  // The catalog is a couple of hundred rows and this runs once per backfill.
  for (const p of kahatiPending) {
    await db.update(products).set({ isKahati: true }).where(eq(products.id, p.id));
  }
  for (const p of groupBuyPending) {
    await db.update(products).set({ isGroupBuy: true }).where(eq(products.id, p.id));
  }

  return { ...report, applied: true };
}
