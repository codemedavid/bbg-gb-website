// Start a new cycle on both boards, against a real database.
//
// DRY RUN BY DEFAULT. Pass --apply to write.
//
//   DATABASE_URL="<url>" npx tsx scripts/start-cycle.ts
//   DATABASE_URL="<url>" npx tsx scripts/start-cycle.ts --apply
//
// This is the same operation the two admin "Start new cycle" buttons perform —
// rollOpenKahatis and rollOpenBatches — reached from a terminal instead of from
// the admin screens. It exists for one situation: the fix that makes a cycle
// refresh empty listings is written and tested but not yet deployed, so the
// buttons on the live site are still running the old code and would do nothing.
//
// It calls the SHIPPED FUNCTIONS rather than issuing its own UPDATEs, and that
// is the whole point of it being a script rather than a hand-written migration.
// The rules for what a refresh may change — which fields move, what a listing
// with joiners is spared, how an unpriceable product is refused — live in
// lib/listing-sync.ts and are covered by lib/cycle-refresh.test.ts. A second
// copy of those rules expressed in SQL would be untested by construction, and
// would drift from the code the moment either changed.
//
// The dry run reports what WOULD move by comparing each empty listing against
// the patch its product would produce, without writing.
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { getDb, groupBuys, moqCampaigns, products } from '@/lib/db';
import { rollOpenKahatis } from '@/lib/kahati-server';
import { rollOpenBatches } from '@/lib/moq-batch-server';
import {
  kahatiRefreshPatch, campaignRefreshPatch, hasListingChanges,
} from '@/lib/listing-sync';
import type { SeedableProduct } from '@/lib/campaign-seed';
import type { IncludedProduct } from '@/lib/types';

type Db = Awaited<ReturnType<typeof getDb>>;

/** What each empty listing would become, without writing any of it. */
async function preview(db: Db): Promise<void> {
  const catalog = await db.select().from(products);
  const byId = new Map(catalog.map((p) => [p.id, p]));

  const counters = await db.select().from(groupBuys)
    .where(and(eq(groupBuys.status, 'open'), eq(groupBuys.claimedSlots, 0)));
  const batches = await db.select().from(moqCampaigns)
    .where(and(eq(moqCampaigns.status, 'open'), eq(moqCampaigns.committed, 0)));

  console.log('\n--- KAHATI: empty counters that would move ---');
  let kahatiMoved = 0;
  for (const counter of counters) {
    const product = counter.productId ? byId.get(counter.productId) : undefined;
    if (!product) continue;
    const patch = kahatiRefreshPatch(product as SeedableProduct, counter);
    if (!hasListingChanges(patch)) continue;
    kahatiMoved += 1;
    const moves = [
      patch.name ? `name "${counter.name}" -> "${patch.name}"` : '',
      patch.pricePerKitPhp ? `price ${counter.pricePerKitPhp} -> ${patch.pricePerKitPhp}` : '',
      patch.totalSlots ? `slots ${counter.totalSlots} -> ${patch.totalSlots}` : '',
      patch.minVials ? `minVials ${counter.minVials} -> ${patch.minVials}` : '',
      patch.arrivalGroup ? `arrival ${counter.arrivalGroup} -> ${patch.arrivalGroup}` : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${counter.name}: ${moves}`);
  }

  console.log('\n--- GROUP BUY: empty batches that would move ---');
  let campaignMoved = 0;
  for (const batch of batches) {
    const includedProducts = (batch.includedProducts as IncludedProduct[]) ?? [];
    if (includedProducts.length === 0) continue;
    let patch = {};
    let relabelled = includedProducts;
    for (const entry of includedProducts) {
      const product = byId.get(entry.productId);
      if (!product) continue;
      const next = campaignRefreshPatch(product as SeedableProduct, { ...batch, includedProducts: relabelled });
      const { includedProducts: entries, ...rest } = next;
      if (entries) relabelled = entries;
      patch = { ...patch, ...rest };
    }
    const full = relabelled === includedProducts ? patch : { ...patch, includedProducts: relabelled };
    if (!hasListingChanges(full)) continue;
    campaignMoved += 1;
    const p = full as Record<string, unknown>;
    const moves = [
      p.name ? `name "${batch.name}" -> "${p.name as string}"` : '',
      p.pricePerKitPhp ? `price ${batch.pricePerKitPhp} -> ${p.pricePerKitPhp as string}` : '',
      p.moq ? `moq ${batch.moq} -> ${p.moq as number}` : '',
      p.perCustomerMin ? `perCustomerMin ${batch.perCustomerMin} -> ${p.perCustomerMin as number}` : '',
      p.arrivalGroup ? `arrival ${batch.arrivalGroup} -> ${p.arrivalGroup as string}` : '',
      p.includedProducts ? 'relabelled included_products' : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${batch.name}: ${moves}`);
  }

  console.log(`\nWould move ${kahatiMoved} counter(s) and ${campaignMoved} batch(es).`);
  console.log(`Untouched: ${counters.length - kahatiMoved} counter(s), ${batches.length - campaignMoved} batch(es) already current or unlinked.`);
}

async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. This script is for a real database; refusing to run against embedded PGlite.');
  }
  const db = await getDb();

  const joinedCounters = await db.select().from(groupBuys).where(eq(groupBuys.status, 'open'));
  const joinedBatches = await db.select().from(moqCampaigns).where(eq(moqCampaigns.status, 'open'));
  const willEndCounters = joinedCounters.filter((c) => c.claimedSlots > 0).length;
  const willEndBatches = joinedBatches.filter((b) => b.committed > 0).length;

  console.log(`\nOpen counters: ${joinedCounters.length}   of those with vials on them (WILL BE ENDED): ${willEndCounters}`);
  console.log(`Open batches:  ${joinedBatches.length}   of those with commitments (WILL BE ENDED): ${willEndBatches}`);

  await preview(db);

  if (!apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to start the cycle.\n');
    return;
  }

  const kahati = await rollOpenKahatis(db);
  const campaign = await rollOpenBatches(db);

  console.log('\n--- APPLIED ---');
  console.log(`Kahati:    ended ${kahati.rolled.length}, refreshed ${kahati.refreshed}, left empty ${kahati.skippedEmpty}, left for cancellation ${kahati.leftForCancellation}, failed ${kahati.failed.length}`);
  for (const f of kahati.failed) console.log(`  FAILED ${f.name}: ${f.reason}`);
  console.log(`Group Buy: ended ${campaign.rolled.length}, refreshed ${campaign.refreshed}, left empty ${campaign.skippedEmpty}`);
  console.log('');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
