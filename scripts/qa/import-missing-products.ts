// Adds price-list products that are missing from the database, WITHOUT the
// table-clearing that scripts/seed.ts does.
//
// seed.ts is a dev bootstrap: it deletes products, orders and users before
// inserting. That makes it unusable against a database holding real orders,
// which is why 20 catalog entries imported earlier never reached production.
// This script closes that gap the only way it safely can — insert-only.
//
// The values come from the reviewed catalog in lib/db/data/catalog.ts, not from
// the raw workbook: that entry carries the spec, category, arrival group and USD
// price a human checked, where a workbook row would give "100.0" as a spec.
//
// Idempotent: a product already present by name + size is skipped, never
// updated. Existing rows are not this script's business.
import 'dotenv/config';
import { asc } from 'drizzle-orm';
import { getDb, closeDb, products, categories } from '../../lib/db';
import { CATEGORIES, CATEGORY_DESC, PRODUCTS } from '../../lib/db/data/catalog';
import {
  excluded, findMatches, describeRow, norm, sizeOf, type PricelistRow,
} from '../../lib/pricelist-match';
import pricelist from '../../data/pricelist.json';

const APPLY = process.argv.includes('--apply');
const ROWS = pricelist.sheets.pricelist as PricelistRow[];

async function main() {
  const db = await getDb();
  const existing = await db.select().from(products).orderBy(asc(products.name));

  const missingRows = ROWS
    .filter((r) => !excluded(r))
    .filter((r) => r.php != null && r.php > 0)
    .filter((r) => findMatches(r, existing).length === 0);

  // Each missing row's reviewed catalog entry, matched the same way the
  // coverage test matches: name + size, never CAT/Code.
  const seedFor = (r: PricelistRow) => findMatches(r, PRODUCTS.map((p) => ({ ...p, spec: p.spec })))[0];

  const plan = missingRows.map((r) => ({ row: r, seed: seedFor(r) }));
  const unresolved = plan.filter((p) => !p.seed);
  const resolved = plan.filter((p) => p.seed);

  console.log(`Missing from the database : ${missingRows.length}`);
  console.log(`Resolved to a catalog entry: ${resolved.length}`);
  if (unresolved.length) {
    console.log(`NO CATALOG ENTRY (not inserted):`);
    unresolved.forEach((p) => console.log(`   - ${describeRow(p.row)}`));
  }

  // Guard against inserting a duplicate of something already in the table under
  // a name the workbook spells differently.
  const haveKey = new Set(existing.map((p) => `${norm(p.name)}|${sizeOf(p.spec)}`));
  const toInsert = resolved.filter((p) => !haveKey.has(`${norm(p.seed!.name)}|${sizeOf(p.seed!.spec)}`));
  console.log(`Will insert                : ${toInsert.length}`);
  toInsert.forEach((p) => console.log(`   + ${p.seed!.name} ${p.seed!.spec}  ₱${p.seed!.pricePhp}  [${p.seed!.cat}]`));

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to insert.');
    await closeDb();
    return;
  }
  if (!toInsert.length) { await closeDb(); return; }

  // Categories the new products need. Created only if genuinely absent.
  const cats = await db.select().from(categories);
  const bySlug = new Map(cats.map((c) => [c.slug, c.id]));
  const neededSlugs = [...new Set(toInsert.map((p) => p.seed!.cat))].filter((s) => !bySlug.has(s));
  for (const slug of neededSlugs) {
    const def = CATEGORIES.find((c) => c.slug === slug);
    const [row] = await db.insert(categories).values({
      name: def?.name ?? slug, slug, sortOrder: def?.sortOrder ?? 99,
    }).returning();
    bySlug.set(slug, row.id);
    console.log(`   (created category ${slug})`);
  }

  const inserted = await db.insert(products).values(toInsert.map(({ seed }) => ({
    code: seed!.code,
    name: seed!.name,
    spec: seed!.spec,
    categoryId: bySlug.get(seed!.cat) ?? null,
    pricePhp: String(seed!.pricePhp),
    priceUsd: seed!.priceUsd != null ? String(seed!.priceUsd) : null,
    isOnHand: !!seed!.isOnHand,
    onHandKitPhp: seed!.onHandKitPhp != null ? String(seed!.onHandKitPhp) : null,
    onHandPiecePhp: seed!.onHandPiecePhp != null ? String(seed!.onHandPiecePhp) : null,
    stock: seed!.stock ?? 0,
    arrivalGroup: seed!.arrival,
    description: CATEGORY_DESC[seed!.cat],
    imageEmoji: seed!.emoji ?? '💧',
    soldCount: seed!.soldCount ?? 0,
  }))).returning();

  console.log(`\nINSERTED ${inserted.length} products.`);
  await closeDb();
}

main().catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
