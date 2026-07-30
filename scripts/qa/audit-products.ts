// Phase 1 QA audit: does the products table carry every row of the price list?
//
// Read-only by default. Pass --fix to create the missing products; it refuses
// unless PGLITE_PATH is set, so an accidental run can never write to Supabase.
import { asc } from 'drizzle-orm';
import { getDb, closeDb, products, categories } from '../../lib/db';
import {
  excluded, findMatches, describeRow, rowKey, sizeOf, type PricelistRow,
} from '../../lib/pricelist-match';
import pricelist from '../../data/pricelist.json';

const FIX = process.argv.includes('--fix');
const ROWS = pricelist.sheets.pricelist as PricelistRow[];

// Category slug per workbook block, mirroring lib/db/data/catalog.ts.
const CATEGORY_FOR_BLOCK: Record<string, string> = { left: 'wellness', right: 'aesthetics' };

async function main() {
  if (FIX && process.env.DATABASE_URL) {
    console.error('Refusing to --fix against DATABASE_URL. QA writes go to PGlite only.');
    process.exit(1);
  }

  const db = await getDb();
  const rows = await db.select().from(products).orderBy(asc(products.name));
  const cats = await db.select().from(categories);

  const priced = ROWS.filter((r) => !excluded(r)).filter((r) => r.php != null && r.php > 0);
  const skipped = ROWS.filter((r) => excluded(r));
  const zeroPriced = ROWS.filter((r) => !excluded(r) && !(r.php != null && r.php > 0));

  const found: string[] = [];
  const missing: PricelistRow[] = [];
  const dupes: string[] = [];

  for (const r of priced) {
    const hits = findMatches(r, rows);
    if (hits.length === 0) { missing.push(r); continue; }
    found.push(`${r.name} ${r.size ?? ''} -> ${hits[0].name} ${hits[0].spec} (${hits[0].id})`);
    if (hits.length > 1) {
      dupes.push(`${describeRow(r)} matches ${hits.length}: ${hits.map((h) => `${h.name} ${h.spec} [${h.id}]`).join(' | ')}`);
    }
  }

  // Duplicates within the table itself, independent of the price list: same
  // normalised name + same size is the same product however it was created.
  const byKey = new Map<string, typeof rows>();
  for (const p of rows) {
    const k = `${rowKey({ name: p.name } as PricelistRow)}|${sizeOf(p.spec)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  const tableDupes = [...byKey.entries()].filter(([, v]) => v.length > 1);

  // Duplicate CAT/Codes — the column has no unique index, so this is possible.
  const byCode = new Map<string, typeof rows>();
  for (const p of rows) {
    if (!p.code) continue;
    byCode.set(p.code, [...(byCode.get(p.code) ?? []), p]);
  }
  const codeDupes = [...byCode.entries()].filter(([, v]) => v.length > 1);

  console.log('='.repeat(72));
  console.log('PHASE 1 — Price list vs Product Management');
  console.log('='.repeat(72));
  console.log(`Price list rows (Pricelist sheet) : ${ROWS.length}`);
  console.log(`  priced + in scope              : ${priced.length}`);
  console.log(`  deliberately excluded          : ${skipped.length}  [${skipped.map((r) => r.name).join(', ')}]`);
  console.log(`  zero/blank price (not imported): ${zeroPriced.length}  [${zeroPriced.map((r) => r.name).join(', ')}]`);
  console.log(`Products in database             : ${rows.length}`);
  console.log('');
  console.log(`FOUND     : ${found.length}`);
  console.log(`MISSING   : ${missing.length}`);
  missing.forEach((r) => console.log(`   - ${describeRow(r)}`));
  console.log(`DUPLICATE (a price-list row matching >1 product): ${dupes.length}`);
  dupes.forEach((d) => console.log(`   ! ${d}`));
  console.log(`DUPLICATE (same name+size rows in the table)    : ${tableDupes.length}`);
  tableDupes.forEach(([k, v]) => console.log(`   ! ${k} -> ${v.map((p) => `${p.name} ${p.spec} [${p.id}]`).join(' | ')}`));
  console.log(`DUPLICATE (same CAT/Code on >1 product)         : ${codeDupes.length}`);
  codeDupes.forEach(([k, v]) => console.log(`   ! code ${k} -> ${v.map((p) => `${p.name} ${p.spec} [${p.id}]`).join(' | ')}`));

  if (FIX && missing.length) {
    const fallback = cats.find((c) => c.slug === 'wellness') ?? cats[0];
    const inserted = await db.insert(products).values(missing.map((r) => ({
      code: r.code,
      name: r.name,
      spec: r.size ? `${r.size}` : '',
      categoryId: (cats.find((c) => c.slug === CATEGORY_FOR_BLOCK[r.block])?.id) ?? fallback?.id ?? null,
      pricePhp: String(r.php),
      priceUsd: r.usd != null ? String(r.usd) : null,
    }))).returning();
    console.log(`\nADDED ${inserted.length} products from the price list.`);
  }

  await closeDb();
  // Non-zero when the catalog does not match the workbook, so this can gate CI.
  process.exitCode = missing.length || dupes.length || tableDupes.length || codeDupes.length ? 1 : 0;
}

main().catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
