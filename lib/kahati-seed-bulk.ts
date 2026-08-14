// Opening a Hatian counter for every product flagged for a group buy.
//
// The mirror of lib/campaign-seed-bulk.ts, for the other board. `is_group_buy`
// is a permission — it says a listing MAY carry this product — and /groupbuys
// renders rows of `group_buys` and nothing else (app/api/groupbuys/route.ts).
// So the permission alone lists nothing; this is the operation that turns 95
// permissions into 95 counters.
//
// It writes the same columns POST /api/admin/groupbuys writes, so a seeded
// counter and a hand-made one are the same kind of row: same card, same join
// sheet, same checkout, same sweep, same admin screen.
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, products, groupBuys } from '@/lib/db';
import { getPackingFees } from '@/lib/settings';
import { kahatiSeedFor } from './kahati-seed';
import type { SeedableProduct } from './campaign-seed';

/** Statuses that mean a product already has a counter customers can join. */
const LIVE_STATUSES = ['open'] as const;

export type OpenKahatisReport = {
  /** Flagged, listed products considered. */
  scanned: number;
  /** Counters opened — or, under dryRun, that would be opened. */
  created: number;
  /** Products already carrying an open counter. */
  skippedExisting: number;
  /** Products with no usable price, named so the gap is visible. */
  skippedUnpriced: string[];
  /** False when `dryRun` held the write back. */
  applied: boolean;
};

/**
 * Opens one counter for every flagged product that does not already have one.
 *
 * Idempotent through the product link: a product carrying an OPEN counter is
 * left alone, whether that counter came from here or from an admin creating it
 * by hand. Closed, shipped, completed and cancelled counters do not count —
 * that batch is over, and one finished hatian must not delist a product
 * forever. This is deliberately narrower than the campaign board's rule, where
 * a completed batch still represents the product because its series continues.
 *
 * Delisted products (`is_active = false`) are skipped: the shop does not sell
 * them, so neither board may offer them.
 */
export async function openKahatisForGroupBuyProducts(
  opts: { dryRun?: boolean } = {},
): Promise<OpenKahatisReport> {
  const db = await getDb();

  const flagged = await db.select().from(products)
    .where(and(
      // The Kahati switch alone, not the Group Buy one: the two channels are
      // independent, so a product may carry counters without ever appearing on
      // the campaign board. Filtered in the query rather than after it, so an
      // off-channel product is never counted as "scanned" either; the report
      // should not imply it was considered and skipped.
      eq(products.isKahati, true),
      eq(products.isActive, true),
    ));

  const live = await db.select({ productId: groupBuys.productId })
    .from(groupBuys)
    .where(inArray(groupBuys.status, [...LIVE_STATUSES]));

  // Counters written before `product_id` existed are free-text rows carrying
  // null here. They cannot claim a product, so they never block one.
  const alreadyListed = new Set(live.map((g) => g.productId).filter(Boolean));

  const pending = flagged.filter((p) => !alreadyListed.has(p.id));
  const skippedExisting = flagged.length - pending.length;

  const seeds = pending.map((p) => ({ product: p, seed: kahatiSeedFor(p as SeedableProduct) }));
  const priced = seeds.filter((s) => s.seed !== null);
  const skippedUnpriced = seeds
    .filter((s) => s.seed === null)
    .map((s) => `${s.product.name} ${s.product.spec}`.trim());

  const report = {
    scanned: flagged.length,
    created: priced.length,
    skippedExisting,
    skippedUnpriced,
  };

  if (opts.dryRun) return { ...report, applied: false };
  if (priced.length === 0) return { ...report, applied: true };

  // The same default a hand-made counter gets, so a seeded hatian and an
  // admin-created one charge the same repack fee.
  const repackFeePhp = String((await getPackingFees()).kahati);

  await db.insert(groupBuys).values(priced.map(({ seed }) => ({
    name: seed!.name,
    productId: seed!.productId,
    pricePerKitPhp: String(seed!.pricePerKitPhp),
    totalSlots: seed!.totalSlots,
    claimedSlots: 0,
    minVials: seed!.minVials,
    repackFeePhp,
    status: 'open' as const,
    // No deadline. A seeded counter closes by filling its kit — which rolls a
    // fresh sibling (lib/kahati-server.ts closeFullKahati) — not by a clock
    // nobody set. An admin who wants one sets it on the counter; the storefront
    // renders "—" until then. Inventing a deadline here would let sweepKahatis
    // cancel a counter, and refund its joiners, on a date no human chose.
    closesAt: null,
    arrivalGroup: seed!.arrivalGroup,
  })))
    // The board reconciles on read, so two concurrent requests can both decide a
    // product needs a counter. `group_buys_one_open_per_product_idx` makes only
    // one of them win; this makes the loser a no-op rather than a 500 that takes
    // the whole board down over work the winner already did.
    .onConflictDoNothing();

  return { ...report, applied: true };
}
