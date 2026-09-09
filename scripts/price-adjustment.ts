// Apply a price-adjustment workbook to the catalog.
//
// DRY RUN BY DEFAULT. Pass --apply to write. The plan itself lives in
// lib/price-adjustment.ts and is tested there; this script is the I/O around
// it — read the workbook, read the catalog, print the plan, and only then
// write the prices the plan lists.
//
//   npx tsx scripts/price-adjustment.ts "<path to .xlsx>"
//   npx tsx scripts/price-adjustment.ts "<path to .xlsx>" --apply
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { getDb, products } from '@/lib/db';
import { planPriceAdjustment, type AdjustmentRow, type PriceableProduct } from '@/lib/price-adjustment';

const cell = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'result' in v) return String((v as { result: unknown }).result);
  if (typeof v === 'object' && v !== null && 'richText' in v) {
    return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
  }
  return String(v);
};

async function readWorkbook(path: string): Promise<AdjustmentRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const rows: AdjustmentRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return; // header
    const name = cell(row.getCell(1).value);
    const php = Number(cell(row.getCell(4).value));
    if (!name || !Number.isFinite(php)) return;
    rows.push({
      row: n, name: name.trim(),
      size: cell(row.getCell(2).value)?.trim() ?? null,
      code: cell(row.getCell(3).value)?.trim() ?? null,
      php,
    });
  });
  return rows;
}

async function main() {
  const [path, ...flags] = process.argv.slice(2);
  if (!path) throw new Error('Usage: tsx scripts/price-adjustment.ts <workbook.xlsx> [--apply]');
  const apply = flags.includes('--apply');

  const rows = await readWorkbook(path);
  const db = await getDb();
  const catalog = await db.select().from(products);
  const priceable: PriceableProduct[] = catalog.map((p) => ({
    id: p.id, name: p.name, spec: p.spec, code: p.code,
    pricePhp: Number(p.pricePhp), isKahati: p.isKahati, isOnHand: p.isOnHand,
  }));

  const plan = planPriceAdjustment(rows, priceable);

  console.log(`\nWorkbook rows: ${rows.length}   Catalog products: ${priceable.length}`);
  console.log(`  updates      ${plan.updates.length}`);
  console.log(`  unchanged    ${plan.unchanged.length}`);
  console.log(`  skippedOnHand ${plan.skippedOnHand.length}`);
  console.log(`  ambiguous    ${plan.ambiguous.length}`);
  console.log(`  unmatched    ${plan.unmatched.length}`);
  console.log(`  excluded     ${plan.excluded.length}`);

  if (plan.updates.length) {
    console.log('\n--- PRICE CHANGES ---');
    for (const u of plan.updates) {
      const delta = u.toPhp - u.fromPhp;
      console.log(`  row ${u.row}  ${u.name} ${u.spec}: ${u.fromPhp} -> ${u.toPhp}  (${delta >= 0 ? '+' : ''}${delta})`);
    }
  }
  for (const [label, list] of [
    ['AMBIGUOUS - not applied', plan.ambiguous.map((a) => `row ${a.row} ${a.name} ${a.size ?? ''} -> ${a.candidates.length} candidates`)],
    ['UNMATCHED - not applied', plan.unmatched.map((u) => `row ${u.row} ${u.name} ${u.size ?? ''} (${u.code ?? 'no code'})`)],
    ['SKIPPED on-hand only', plan.skippedOnHand.map((s) => `row ${s.row} ${s.name}`)],
    ['EXCLUDED', plan.excluded.map((e) => `row ${e.row} ${e.name} — ${e.why}`)],
  ] as const) {
    if (list.length) console.log(`\n--- ${label} ---\n  ${list.join('\n  ')}`);
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to write these prices.\n');
    return;
  }
  for (const u of plan.updates) {
    await db.update(products).set({ pricePhp: String(u.toPhp) }).where(eq(products.id, u.productId));
  }
  console.log(`\nAPPLIED ${plan.updates.length} price changes.\n`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
