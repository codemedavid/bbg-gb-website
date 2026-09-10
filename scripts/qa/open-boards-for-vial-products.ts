// Puts every product the boards can carry onto both boards.
//
// Two steps, and they must run in this order:
//
//   1. openBoardsForVialProducts   — tick `is_kahati` / `is_group_buy` on every
//                                    product whose supplier kit splits ten ways
//   2. openCampaignsForGroupBuyProducts / openKahatisForGroupBuyProducts
//                                  — turn those permissions into listings
//
// Step 2 reads the switches step 1 writes, so reversing them lists nothing. The
// two seeders are the same ones both boards run on every read, so this is only
// bringing forward work the next page load would have done anyway — worth doing
// here so the numbers are printed once, against a named database.
//
// The rules live in lib/product-board-eligibility.ts, lib/product-board-bulk.ts,
// lib/campaign-seed-bulk.ts and lib/kahati-seed-bulk.ts, and are covered by
// their test files. This is only the runner: it names the database it is about
// to touch, prints the numbers, and is a dry run unless given --apply.
//
//   Local PGlite : DATABASE_URL= npx tsx scripts/qa/open-boards-for-vial-products.ts --apply
//   Production   : npx tsx scripts/qa/open-boards-for-vial-products.ts            (dry run)
//                  npx tsx scripts/qa/open-boards-for-vial-products.ts --apply
import 'dotenv/config';
import { closeDb } from '../../lib/db';
import { openBoardsForVialProducts } from '../../lib/product-board-bulk';
import { openCampaignsForGroupBuyProducts } from '../../lib/campaign-seed-bulk';
import { openKahatisForGroupBuyProducts } from '../../lib/kahati-seed-bulk';

const APPLY = process.argv.includes('--apply');

// Host only — the connection string carries a password.
function describeTarget(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return 'local PGlite (no DATABASE_URL set)';
  try {
    return `postgres ${new URL(url).host}`;
  } catch {
    return 'postgres (unparseable DATABASE_URL)';
  }
}

const label = (s: string) => `   ${s.padEnd(30)}:`;

async function main() {
  console.log(`Target: ${describeTarget()}`);
  console.log(APPLY ? 'Mode  : APPLY (writes)\n' : 'Mode  : DRY RUN (no writes)\n');

  console.log('1. Opening both switches on every ten-vial kit product');
  const switches = await openBoardsForVialProducts({ dryRun: !APPLY });
  console.log(`${label('products in the catalog')} ${switches.scanned}`);
  console.log(`${label('kit splits ten ways')} ${switches.eligible}`);
  console.log(`${label(APPLY ? 'Kahati opened' : 'Kahati would open')} ${switches.kahatiOpened}`);
  console.log(`${label(APPLY ? 'Group Buy opened' : 'Group Buy would open')} ${switches.groupBuyOpened}`);
  if (switches.skippedUnpriced.length) {
    console.log(`${label('ten-vial kits with no price')} ${switches.skippedUnpriced.length}`);
    switches.skippedUnpriced.forEach((n) => console.log(`      - ${n}`));
  }

  // A dry run ticks nothing, so the seeders below would judge the catalog as it
  // stands and report only the listings that were already missing. That is a
  // real number but not the one this run is about, so say so rather than
  // printing it under a heading that implies otherwise.
  if (!APPLY) {
    console.log('\n2. Opening campaign batches   — skipped in a dry run');
    console.log('3. Opening hatian counters    — skipped in a dry run');
    console.log(`\nDRY RUN. Re-run with --apply to open Kahati on ${switches.kahatiOpened} `
      + `and Group Buy on ${switches.groupBuyOpened} products, then list them on both boards.`);
    await closeDb();
    return;
  }

  console.log('\n2. Opening a campaign batch for each flagged product');
  const campaigns = await openCampaignsForGroupBuyProducts();
  console.log(`${label('flagged, listed products')} ${campaigns.scanned}`);
  console.log(`${label('already on the board')} ${campaigns.skippedExisting}`);
  console.log(`${label('campaigns opened')} ${campaigns.created}`);
  if (campaigns.skippedUnpriced.length) {
    console.log(`${label('no usable price (skipped)')} ${campaigns.skippedUnpriced.length}`);
    campaigns.skippedUnpriced.forEach((n) => console.log(`      - ${n}`));
  }

  console.log('\n3. Opening a hatian counter for each flagged product');
  const hatians = await openKahatisForGroupBuyProducts();
  console.log(`${label('flagged, listed products')} ${hatians.scanned}`);
  console.log(`${label('already carrying a counter')} ${hatians.skippedExisting}`);
  console.log(`${label('counters opened')} ${hatians.created}`);
  if (hatians.skippedUnpriced.length) {
    console.log(`${label('no usable price (skipped)')} ${hatians.skippedUnpriced.length}`);
    hatians.skippedUnpriced.forEach((n) => console.log(`      - ${n}`));
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
