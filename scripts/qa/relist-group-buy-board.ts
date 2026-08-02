// Relists both group buy boards at corrected prices.
//
// Seeded campaigns were opened at ten times their real price (products.price_php
// is a PER-KIT figure, not per vial — see lib/campaign-seed.ts). This runs the
// three operations that fix the board, in the only order that works:
//
//   1. cancelMispricedCampaigns   — take the ten-times campaigns off the board
//   2. openCampaignsForGroupBuyProducts — reopen them at the corrected price
//   3. openKahatisForGroupBuyProducts   — open a hatian counter alongside each
//
// Step 2 must follow step 1: its idempotency guard skips any product already
// carried by an open campaign, so reopening before cancelling would do nothing.
//
// The rules live in lib/campaign-reprice.ts, lib/campaign-seed-bulk.ts and
// lib/kahati-seed-bulk.ts and are covered by their test files — this is only the
// runner: it names the database, prints the numbers, and is a dry run unless
// given --apply.
//
//   Local PGlite : DATABASE_URL= npx tsx scripts/qa/relist-group-buy-board.ts --apply
//   Production   : npx tsx scripts/qa/relist-group-buy-board.ts            (dry run)
//                  npx tsx scripts/qa/relist-group-buy-board.ts --apply
import 'dotenv/config';
import { closeDb } from '../../lib/db';
import { cancelMispricedCampaigns } from '../../lib/campaign-reprice';
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

async function main() {
  console.log(`Target: ${describeTarget()}`);
  console.log(APPLY ? 'Mode  : APPLY (writes)\n' : 'Mode  : DRY RUN (no writes)\n');

  console.log('1. Cancelling mispriced campaigns');
  const reprice = await cancelMispricedCampaigns({ dryRun: !APPLY });
  console.log(`   open campaigns scanned        : ${reprice.scanned}`);
  console.log(`   carrying the ten-times price  : ${reprice.mispriced}`);
  console.log(`   ${(APPLY ? 'cancelled' : 'would cancel').padEnd(30)}: ${reprice.cancelled}`);
  if (reprice.skippedCommitted.length) {
    console.log(`   HOLDING COMMITMENTS — left alone, reprice these by hand:`);
    reprice.skippedCommitted.forEach((n) => console.log(`      - ${n}`));
  }

  // A dry run cancels nothing, so the seeders below would still see every
  // product as listed and report zero. Say so rather than printing a
  // misleading "would open: 0".
  if (!APPLY) {
    console.log('\n2. Reopening campaigns  — skipped in a dry run');
    console.log('3. Opening hatian counters — skipped in a dry run');
    console.log(`\nDRY RUN. Re-run with --apply to cancel ${reprice.cancelled}, `
      + 'reopen them at the corrected price, and open a hatian for each product.');
    await closeDb();
    return;
  }

  console.log('\n2. Reopening campaigns at the corrected price');
  const campaigns = await openCampaignsForGroupBuyProducts();
  console.log(`   flagged, listed products      : ${campaigns.scanned}`);
  console.log(`   already on the board          : ${campaigns.skippedExisting}`);
  console.log(`   campaigns opened              : ${campaigns.created}`);
  if (campaigns.skippedUnpriced.length) {
    console.log(`   no usable price (skipped)     : ${campaigns.skippedUnpriced.length}`);
    campaigns.skippedUnpriced.forEach((n) => console.log(`      - ${n}`));
  }

  console.log('\n3. Opening a hatian counter for each product');
  const hatians = await openKahatisForGroupBuyProducts();
  console.log(`   flagged, listed products      : ${hatians.scanned}`);
  console.log(`   already carrying a counter    : ${hatians.skippedExisting}`);
  console.log(`   counters opened               : ${hatians.created}`);
  if (hatians.skippedUnpriced.length) {
    console.log(`   no usable price (skipped)     : ${hatians.skippedUnpriced.length}`);
    hatians.skippedUnpriced.forEach((n) => console.log(`      - ${n}`));
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
