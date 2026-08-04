// Turning the Group Buy switch on across the whole catalog.
//
// `products.is_group_buy` is the per-product switch an admin ticks in the
// product form ("Offer through Group Buy"). It is a catalog setting, not a
// listing: it says a campaign or a hatian carrying this product may seed its
// terms from the product's gb_* columns. Ticking it 95 times by hand is not a
// plan, so this is the one operation that ticks all of them.
//
// It writes the switch and nothing else. The gb_* terms stay exactly as they
// are — every one of them is nullable, and null means "not configured", which
// falls back to the global defaults in lib/pricing.ts. Writing zeros there
// instead would read as a free kit (see lib/db/schema.ts).
import { eq } from 'drizzle-orm';
import { getDb, products } from '@/lib/db';

/** What a run did, or — under `dryRun` — what a run would do. */
export type OpenGroupBuyReport = {
  /** Products in the catalog, delisted ones included. */
  scanned: number;
  /** Products whose switch was already on. Left untouched. */
  alreadyOpen: number;
  /** Products whose switch was off: opened, or awaiting a real run. */
  pending: number;
  /** False when `dryRun` held the write back. */
  applied: boolean;
};

/**
 * Opens Group Buy on every product that does not already have it open.
 *
 * Idempotent: the UPDATE is scoped to the rows that are still off, so a re-run
 * after a partial failure touches nothing and reports `pending: 0`. It cannot
 * re-open a switch an admin has since deliberately turned back off either —
 * that would need a second run, which is a decision, not an accident.
 *
 * Delisted products are opened too. `is_active` governs whether the shop lists
 * the product; this switch governs whether a group buy may carry it. Skipping
 * inactive rows would only mean re-running this the day one is relisted.
 */
export async function openGroupBuyForAllProducts(
  opts: { dryRun?: boolean } = {},
): Promise<OpenGroupBuyReport> {
  const db = await getDb();

  const rows = await db.select({ isGroupBuy: products.isGroupBuy }).from(products);
  const alreadyOpen = rows.filter((r) => r.isGroupBuy).length;
  const pending = rows.length - alreadyOpen;

  if (opts.dryRun) {
    return { scanned: rows.length, alreadyOpen, pending, applied: false };
  }

  if (pending > 0) {
    await db.update(products)
      .set({ isGroupBuy: true })
      .where(eq(products.isGroupBuy, false));
  }

  return { scanned: rows.length, alreadyOpen, pending, applied: true };
}
