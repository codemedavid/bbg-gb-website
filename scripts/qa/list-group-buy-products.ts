// Opens a Group Buy campaign for every flagged product, so /groupbuy lists them.
//
// The rules live in lib/campaign-seed-bulk.ts and are covered by its test file —
// this is only the runner: it names the database, prints the numbers, and is a
// dry run unless given --apply.
//
//   Local PGlite : DATABASE_URL= npx tsx scripts/qa/list-group-buy-products.ts --apply
//   Production   : npx tsx scripts/qa/list-group-buy-products.ts            (dry run)
//                  npx tsx scripts/qa/list-group-buy-products.ts --apply
import 'dotenv/config';
import { closeDb } from '../../lib/db';
import { openCampaignsForGroupBuyProducts } from '../../lib/campaign-seed-bulk';

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

  const report = await openCampaignsForGroupBuyProducts({ dryRun: !APPLY });

  console.log(`Flagged, listed products : ${report.scanned}`);
  console.log(`Already on the board     : ${report.skippedExisting}`);
  console.log(`${APPLY ? 'Campaigns opened        ' : 'Would open              '}: ${report.created}`);

  if (report.skippedUnpriced.length) {
    console.log(`No usable price (skipped): ${report.skippedUnpriced.length}`);
    report.skippedUnpriced.forEach((n) => console.log(`   - ${n}`));
  }

  if (!APPLY) console.log('\nDRY RUN — pass --apply to write.');

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
