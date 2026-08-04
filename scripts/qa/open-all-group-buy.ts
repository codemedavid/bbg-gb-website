// Turns the Group Buy switch on for every product in the database behind
// DATABASE_URL.
//
// The rules live in lib/product-group-buy-bulk.ts and are covered by
// lib/product-group-buy-bulk.test.ts — this file is only the runner: it names
// the database it is about to touch, prints the numbers, and refuses to write
// unless asked. Dry run is the default precisely because the interesting target
// is production.
//
//   Local PGlite : DATABASE_URL= npx tsx scripts/qa/open-all-group-buy.ts --apply
//   Production   : npx tsx scripts/qa/open-all-group-buy.ts            (dry run)
//                  npx tsx scripts/qa/open-all-group-buy.ts --apply
import 'dotenv/config';
import { closeDb } from '../../lib/db';
import { openGroupBuyForAllProducts } from '../../lib/product-group-buy-bulk';

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

  const report = await openGroupBuyForAllProducts({ dryRun: !APPLY });

  console.log(`Products scanned      : ${report.scanned}`);
  console.log(`Already open          : ${report.alreadyOpen}`);
  console.log(`${APPLY ? 'Opened                ' : 'Would open            '}: ${report.pending}`);

  if (!APPLY) console.log('\nDRY RUN — pass --apply to write.');

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
