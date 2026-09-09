// Applying a planned price adjustment — to the catalog AND to the boards.
//
// lib/price-adjustment.ts plans the change and writes nothing; this performs it.
// It exists as a module rather than as a loop inside scripts/price-adjustment.ts
// because that loop was wrong in a way a script cannot be tested out of: it
// wrote `products.price_php` and stopped there.
//
// Stopping there is not a small omission. A listing seeds its terms from its
// product once, when it opens, so the boards do not re-read the catalog on their
// own — lib/listing-sync-server.ts is what carries a catalog change out to the
// listings already on them, and until now its only caller was the single-product
// admin PATCH. A workbook applied through the bulk path therefore moved the
// catalog and left both boards quoting the old money: on 2026-09-09, 34 of the
// 87 product-linked Kahati counters offered a price the catalog no longer said.
//
// So the write and the sync are one operation here, per product, in one
// transaction — the same shape PATCH /api/admin/products/[id] already uses, for
// the same reason: the catalog is the authority for what both boards charge, and
// the two must never be observed disagreeing.
import { eq } from 'drizzle-orm';
import { getDb, products } from '@/lib/db';
import { syncListingsForProduct } from './listing-sync-server';
import type { PriceUpdate } from './price-adjustment';
import type { SeedableProduct } from './campaign-seed';

type Db = Awaited<ReturnType<typeof getDb>>;

export type PriceApplyReport = {
  /** Catalog rows repriced. Lower than the plan's when a product has since gone. */
  products: number;
  /** Open hatian counters the repricing moved. */
  kahatis: number;
  /** Open campaign batches the repricing moved. */
  campaigns: number;
};

/**
 * Writes each planned price and pushes it onto the listings that product opened.
 *
 * One transaction PER PRODUCT rather than one around the whole run. A workbook
 * carries dozens of unrelated rows, and a single bad one — a product deleted
 * between the plan and the apply — must not roll back the eighty prices that
 * applied cleanly. What has to be atomic is narrower: a product's price and the
 * listings quoting it, which is exactly what each transaction holds.
 *
 * A product that no longer exists is skipped rather than throwing. The plan was
 * computed against a catalog read earlier, so this is a real race, and the
 * report's `products` count is what says how many of the planned rows landed.
 *
 * How far a price travels is lib/listing-sync.ts's decision, not this module's:
 * a product carrying its own group buy price is listed at THAT, so moving its
 * shop price correctly moves nothing on either board.
 */
export async function applyPriceUpdates(
  db: Db,
  updates: readonly PriceUpdate[],
): Promise<PriceApplyReport> {
  let repriced = 0;
  let kahatis = 0;
  let campaigns = 0;

  for (const update of updates) {
    const synced = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(products).where(eq(products.id, update.productId));
      if (!before) return null;
      const [after] = await tx.update(products)
        .set({ pricePhp: String(update.toPhp) })
        .where(eq(products.id, update.productId))
        .returning();
      return syncListingsForProduct(tx, before as SeedableProduct, after as SeedableProduct);
    });
    if (!synced) continue;

    repriced += 1;
    kahatis += synced.kahatis;
    campaigns += synced.campaigns;
  }

  return { products: repriced, kahatis, campaigns };
}
