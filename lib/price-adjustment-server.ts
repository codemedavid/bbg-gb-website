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
import { groupBuyVialsPerKit, round2 } from './pricing';
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
 * A product carrying its own group buy kit price is listed at THAT, not at the
 * shop price, so the override moves to the new figure with it — and the
 * explicit per-vial price, when there is one, is re-derived from the new kit
 * (the order calculator quotes it ahead of the kit; a counter charges the kit
 * divided down, and the two must agree). The override is not a discount in
 * prod: 102 of 172 products carry one, holding the previous kit price under a
 * second column, which is how the Sep 9 run moved the catalog and left 50
 * open counters and 40 open batches quoting last week's money. A product with
 * no override gets none.
 *
 * How far the price then travels onto the boards is lib/listing-sync.ts's
 * decision, not this module's.
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
        .set(repricedColumns(before, update.toPhp))
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

type ProductRow = typeof products.$inferSelect;
type RepricedColumns = Pick<typeof products.$inferInsert, 'pricePhp' | 'gbPricePerKitPhp' | 'gbPricePerPiecePhp'>;

// The price columns the new kit price lands in, given what the product carried.
const hasMoney = (raw: string | null): boolean => raw != null && Number(raw) > 0;

function repricedColumns(before: ProductRow, toPhp: number): RepricedColumns {
  const columns: RepricedColumns = { pricePhp: String(toPhp) };
  if (hasMoney(before.gbPricePerKitPhp)) columns.gbPricePerKitPhp = String(toPhp);
  if (hasMoney(before.gbPricePerPiecePhp)) {
    columns.gbPricePerPiecePhp = String(round2(toPhp / groupBuyVialsPerKit(before)));
  }
  return columns;
}
