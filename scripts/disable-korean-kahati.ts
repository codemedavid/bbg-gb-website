// npx tsx scripts/disable-korean-kahati.ts [--apply]
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { getDb, closeDb, products, categories } from '../lib/db';

async function main() {
  const db = await getDb();
  const rows = await db.select({ id: products.id, name: products.name, isKahati: products.isKahati })
    .from(products).innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(categories.slug, 'aesthetics'));
  console.log(JSON.stringify({ products: rows, disabling: rows.filter((p) => p.isKahati).length }, null, 2));
  if (!process.argv.includes('--apply')) return;
  const statements = readFileSync(new URL('../drizzle/0034_korean_kahati_default.sql', import.meta.url), 'utf8')
    .split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
  await db.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  });
  const after = await db.select({ isKahati: products.isKahati }).from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id)).where(eq(categories.slug, 'aesthetics'));
  if (after.some((p) => p.isKahati)) throw new Error('Some Korean products are still enabled for Kahati.');
  console.log(`Verified: all ${after.length} Korean products have Kahati disabled.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
