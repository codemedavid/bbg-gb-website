// Opening a Group Buy campaign for every product flagged for one.
//
// `products.is_group_buy` is a permission — it says a campaign MAY carry this
// product. /groupbuy lists campaigns (app/api/campaigns/route.ts reads
// moq_campaigns and nothing else), so the permission alone lists nothing. This
// is the operation that turns permissions into listings.
//
// It deliberately opens campaigns rather than teaching the board to render
// products: a campaign already has a card, a cart line, a checkout path,
// batching and admin screens, all tested. A parallel product-shaped listing
// would need every one of those again. The product is linked through
// `included_products`, the same link the admin campaign form writes — so this
// needs no new column and no migration.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, products, moqCampaigns } from '@/lib/db';
import { getPackingFees } from '@/lib/settings';
import { campaignSeedFor, type SeedableProduct } from './campaign-seed';
import type { IncludedProduct } from './types';

/** Statuses that mean a product is already represented on the board. */
const LIVE_STATUSES = ['open', 'approved', 'completed'] as const;

export type OpenCampaignsReport = {
  /** Flagged, listed products considered. */
  scanned: number;
  /** Campaigns opened — or, under dryRun, that would be opened. */
  created: number;
  /** Products already carried by a live campaign. */
  skippedExisting: number;
  /** Products with no usable price, named so the gap is visible. */
  skippedUnpriced: string[];
  applied: boolean;
};

/**
 * Opens batch #1 of a series for every flagged product that is not already on
 * the board.
 *
 * Idempotent through `included_products`: a product carried by an open,
 * approved or completed campaign is left alone, whether that campaign came from
 * here or from an admin listing it by hand. A cancelled campaign does not count
 * — that batch is over, and one cancellation must not delist a product forever.
 *
 * Delisted products (`is_active = false`) are skipped. The shop does not sell
 * them, so the group buy board must not offer them either.
 */
export async function openCampaignsForGroupBuyProducts(
  opts: { dryRun?: boolean } = {},
): Promise<OpenCampaignsReport> {
  const db = await getDb();

  const flagged = await db.select().from(products)
    .where(and(eq(products.isGroupBuy, true), eq(products.isActive, true)));

  const live = await db.select({ includedProducts: moqCampaigns.includedProducts })
    .from(moqCampaigns)
    .where(inArray(moqCampaigns.status, [...LIVE_STATUSES]));

  const alreadyListed = new Set(
    live.flatMap((c) => (c.includedProducts as IncludedProduct[]).map((p) => p.productId)),
  );

  const pending = flagged.filter((p) => !alreadyListed.has(p.id));
  const skippedExisting = flagged.length - pending.length;

  const seeds = pending.map((p) => ({ product: p, seed: campaignSeedFor(p as SeedableProduct) }));
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

  // The same default an admin-created campaign gets, so a seeded batch and a
  // hand-made one charge the same packing fee.
  const shippingPhp = String((await getPackingFees()).group_buy);

  await db.insert(moqCampaigns).values(priced.map(({ seed }) => {
    // The id is minted here rather than by the database so the row can point its
    // series at itself in the same INSERT — exactly as POST /api/campaigns does.
    const id = randomUUID();
    return {
      id,
      seriesId: id,
      batchNo: 1,
      name: seed!.name,
      pricePerKitPhp: String(seed!.pricePerKitPhp),
      moq: seed!.moq,
      perCustomerMin: seed!.perCustomerMin,
      shippingPhp,
      status: 'open' as const,
      deadline: null,
      includedProducts: seed!.includedProducts,
      arrivalGroup: seed!.arrivalGroup,
    };
  }));

  return { ...report, applied: true };
}
