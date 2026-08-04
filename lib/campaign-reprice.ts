// Taking the mispriced campaigns off the board so correctly priced ones replace them.
//
// Seeded campaigns were opened at the product's shop price TIMES the kit size,
// on the belief that `products.price_php` held a per-vial figure. It does not —
// the source workbook heads that column "PER KIT (10 VIALS) PRICE" — so every
// seeded campaign listed at ten times its real price. lib/campaign-seed.ts no
// longer makes that mistake, but a campaign already on the board keeps whatever
// price it was opened with. This clears them out.
//
// It CANCELS rather than edits, because the board already has that lifecycle:
// cancelling closes the batch, and openCampaignsForGroupBuyProducts then opens a
// fresh one at the corrected price. Two existing, tested paths beat a new
// in-place price mutation that nothing else in the codebase performs.
import { and, eq } from 'drizzle-orm';
import { getDb, products, moqCampaigns } from '@/lib/db';
import { groupBuyVialsPerKit, round2 } from './pricing';
import type { IncludedProduct } from './types';

export type RepriceReport = {
  /** Open campaigns considered. */
  scanned: number;
  /** Of those, carrying the pre-fix kit-size multiple. */
  mispriced: number;
  /** Actually taken off the board — or, under dryRun, that would be. */
  cancelled: number;
  /** Mispriced but holding commitments: left alone, named for a human. */
  skippedCommitted: string[];
  /** False when `dryRun` held the write back. */
  applied: boolean;
};

/**
 * Cancels every open campaign still carrying the pre-fix price.
 *
 * "Mispriced" is deliberately the bug's exact fingerprint — the listed price
 * equals the product's shop price multiplied by that product's kit size —
 * rather than "differs from what the seeder would now produce". An admin who
 * lowered a campaign to its group buy discount ALSO differs from the seed, and
 * cancelling that would destroy deliberate work. Only the multiple is touched.
 *
 * A batch holding commitments is never cancelled. Cancelling a campaign is a
 * bare status flip with no order-release flow — unlike a hatian's, which
 * refunds its joiners (lib/kahati-server.ts) — so doing it to a committed batch
 * would strand real customer orders behind a dead listing. Those are reported
 * by name and left for a human to reprice or settle deliberately.
 *
 * Idempotent: cancelled batches are no longer open, so a second run matches
 * nothing.
 */
export async function cancelMispricedCampaigns(
  opts: { dryRun?: boolean } = {},
): Promise<RepriceReport> {
  const db = await getDb();

  const open = await db.select().from(moqCampaigns).where(eq(moqCampaigns.status, 'open'));
  const catalog = await db.select().from(products);
  const byId = new Map(catalog.map((p) => [p.id, p]));

  const mispriced = open.filter((c) => {
    const [first] = (c.includedProducts as IncludedProduct[]) ?? [];
    // A free-text campaign links no product, so there is no shop price to
    // compare against and no way to tell a bug from an admin's own figure.
    const p = first ? byId.get(first.productId) : undefined;
    if (!p) return false;

    const shop = Number(p.pricePhp);
    if (!Number.isFinite(shop) || shop <= 0) return false;

    const scaled = round2(shop * groupBuyVialsPerKit(p));
    // A one-vial kit makes the multiple identical to the correct price; there is
    // nothing wrong with such a row and nothing to gain by relisting it.
    if (scaled === round2(shop)) return false;

    return round2(Number(c.pricePerKitPhp)) === scaled;
  });

  const committed = mispriced.filter((c) => c.committed > 0);
  const cancellable = mispriced.filter((c) => c.committed <= 0);

  const report = {
    scanned: open.length,
    mispriced: mispriced.length,
    cancelled: cancellable.length,
    skippedCommitted: committed.map((c) => c.name),
  };

  if (opts.dryRun) return { ...report, applied: false };

  for (const c of cancellable) {
    // Guarded on 'open' so a run racing an admin approval or a checkout that
    // completed the batch loses rather than reopening a decided lifecycle.
    await db.update(moqCampaigns)
      .set({ status: 'cancelled' })
      .where(and(eq(moqCampaigns.id, c.id), eq(moqCampaigns.status, 'open')));
  }

  return { ...report, applied: true };
}
