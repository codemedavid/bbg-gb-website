// Carrying a product edit out to the listings it already opened — database side.
//
// lib/kahati-seed-bulk.ts and lib/campaign-seed-bulk.ts turn a product into a
// listing once, when the boards next reconcile. This is the other direction of
// that same link: an edit in product management reaching the counters and
// batches that are already out there, so the price a customer sees on the board
// is the price the catalog says today rather than the price it said the morning
// the listing opened.
//
// What travels and what is clamped is decided by lib/listing-sync.ts. This
// module only chooses WHICH rows are eligible, and it is deliberately narrow:
//
//   • OPEN listings only. A closed, shipped, approved or completed batch is
//     history — its kit is ordered and its joiners are settling against a price
//     they already agreed to. Repricing it would rewrite what people owe.
//   • Listings linked to THIS product. A counter with no product link is a
//     free-text row an admin typed by hand, and nothing in the catalog speaks
//     for it.
//
// Past orders are unaffected either way: order lines snapshot the name and unit
// price they were placed at (order_items.name_snapshot / unit_price_php), so a
// repriced counter changes what the NEXT joiner pays, never what an existing
// one owes.
import { and, eq } from 'drizzle-orm';
import { getDb, products, groupBuys, moqCampaigns } from '@/lib/db';
import {
  kahatiListingPatch, campaignListingPatch, hasListingChanges,
} from './listing-sync';
import type { SeedableProduct } from './campaign-seed';
import type { IncludedProduct } from './types';

type Db = Awaited<ReturnType<typeof getDb>>;

/** The catalog row as stored, which is what both boards seed from. */
export type ProductRow = typeof products.$inferSelect;

export type ListingSyncReport = {
  /** Open hatian counters this edit changed. */
  kahatis: number;
  /** Open campaign batches this edit changed. */
  campaigns: number;
};

/**
 * Pushes one product edit onto every open listing carrying that product.
 *
 * `before` and `after` are the catalog row either side of the UPDATE — the edit
 * itself, not the product's full terms. A field only travels when the edit
 * moved the value that board derives from it, so restocking, a description
 * rewrite or a COA upload writes nothing, and an admin's hand-set price on one
 * counter survives every edit that was not about price.
 *
 * Every write is guarded on the listing still being open, so a sync racing a
 * checkout that filled the counter, or an admin approving the batch, loses
 * rather than reopening a decided lifecycle. Idempotent: running it twice with
 * the same pair changes nothing the second time, because the second run
 * compares the same two products and produces the same patch against rows that
 * already carry it.
 */
export async function syncListingsForProduct(
  db: Db,
  before: SeedableProduct,
  after: SeedableProduct,
): Promise<ListingSyncReport> {
  return {
    kahatis: await syncKahatis(db, before, after),
    campaigns: await syncCampaigns(db, before, after),
  };
}

async function syncKahatis(db: Db, before: SeedableProduct, after: SeedableProduct): Promise<number> {
  const open = await db.select().from(groupBuys)
    .where(and(eq(groupBuys.productId, after.id), eq(groupBuys.status, 'open')));

  let changed = 0;
  for (const row of open) {
    const patch = kahatiListingPatch(before, after, row);
    if (!hasListingChanges(patch)) continue;
    const updated = await db.update(groupBuys).set(patch)
      .where(and(eq(groupBuys.id, row.id), eq(groupBuys.status, 'open')))
      .returning({ id: groupBuys.id });
    changed += updated.length;
  }
  return changed;
}

async function syncCampaigns(db: Db, before: SeedableProduct, after: SeedableProduct): Promise<number> {
  // `included_products` is JSONB, so which batches carry this product is decided
  // here rather than in the WHERE — the same read-then-filter the campaign
  // seeder does, for the same reason: one shape of that lookup, in JavaScript,
  // instead of a hand-written containment predicate per driver.
  const open = await db.select().from(moqCampaigns)
    .where(eq(moqCampaigns.status, 'open'));

  let changed = 0;
  for (const row of open) {
    const includedProducts = (row.includedProducts as IncludedProduct[]) ?? [];
    if (!includedProducts.some((p) => p.productId === after.id)) continue;

    const patch = campaignListingPatch(before, after, { ...row, includedProducts });
    if (!hasListingChanges(patch)) continue;
    const updated = await db.update(moqCampaigns).set(patch)
      .where(and(eq(moqCampaigns.id, row.id), eq(moqCampaigns.status, 'open')))
      .returning({ id: moqCampaigns.id });
    changed += updated.length;
  }
  return changed;
}
