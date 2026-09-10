// Ticking both board switches across the catalog, by rule.
//
// The mirror of lib/product-group-buy-bulk.test.ts, which opened ONE switch on
// EVERY row. This opens BOTH switches on the rows lib/product-board-eligibility.ts
// says the boards can carry, which is what the catalog actually needs: the shop
// sells 164 products and the boards were carrying 94.
//
// It has to be safe enough to run against production, so the tests below pin
// the same three properties the older operation pins, plus one this one adds:
//
//   1. It writes ONLY the switches. Touching the gb_* terms would overwrite the
//      catalog's pricing with defaults, and a ₱0 kit reads as free.
//   2. It is idempotent, so a re-run after a partial failure changes nothing.
//   3. It can be rehearsed — `dryRun` reports the exact numbers a real run
//      would write.
//   4. It never turns a switch OFF. An admin's deliberate exclusion outranks
//      this rule, and a backfill that un-ticked things would silently delist
//      products between runs.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, products, categories } from '@/lib/db';
import { resetDb } from '@/lib/test/harness';
import { openBoardsForVialProducts } from './product-board-bulk';

beforeEach(resetDb);

async function seedProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
  const db = await getDb();
  const [cat] = await db.insert(categories).values({
    name: 'Peptides', slug: `peptides-${Math.random().toString(36).slice(2, 8)}`,
  }).returning();
  const [row] = await db.insert(products).values({
    name: 'Retatrutide', spec: '20mg vial', categoryId: cat.id,
    pricePhp: '5688', stock: 100, kitSize: 10, isActive: true,
    // Both switches off: that is the state the catalog is actually in, and the
    // one this operation exists to change.
    isGroupBuy: false, isKahati: false,
    ...overrides,
  }).returning();
  return row;
}

describe('openBoardsForVialProducts', () => {
  it('ticks both switches on every product whose kit splits ten ways', async () => {
    await seedProduct({ name: 'Retatrutide' });
    await seedProduct({ name: 'Tirzepatide' });
    await seedProduct({ name: 'BPC157' });

    const report = await openBoardsForVialProducts();

    expect(report.eligible).toBe(3);
    expect(report.kahatiOpened).toBe(3);
    expect(report.groupBuyOpened).toBe(3);
    expect(report.applied).toBe(true);

    const db = await getDb();
    const rows = await db.select().from(products);
    expect(rows.every((r) => r.isKahati && r.isGroupBuy)).toBe(true);
  });

  it('leaves a single-syringe filler off both boards', async () => {
    await seedProduct({ name: 'Rejuran i', spec: '1 prefilled syringe, 1ml', kitSize: 1 });

    const report = await openBoardsForVialProducts();

    expect(report.eligible).toBe(0);
    expect(report.kahatiOpened).toBe(0);

    const db = await getDb();
    const [row] = await db.select().from(products).where(eq(products.name, 'Rejuran i'));
    expect(row.isKahati).toBe(false);
    expect(row.isGroupBuy).toBe(false);
  });

  it('never turns a switch back off, even on a product the rule refuses', async () => {
    // The sticker rows already carry Group Buy, ticked by hand. This rule would
    // not have ticked it — but un-ticking it is an admin's decision, not a
    // backfill's.
    await seedProduct({
      name: 'VIAL HOLOGRAPHIC STICKER', spec: '15mg Tirzepatide',
      pricePhp: '5', isGroupBuy: true,
    });

    await openBoardsForVialProducts();

    const db = await getDb();
    const [row] = await db.select().from(products);
    expect(row.isGroupBuy).toBe(true);
    expect(row.isKahati).toBe(false);
  });

  it('counts a switch that was already on separately from the ones it opens', async () => {
    await seedProduct({ name: 'Already on both', isGroupBuy: true, isKahati: true });
    await seedProduct({ name: 'Group buy only', isGroupBuy: true, isKahati: false });
    await seedProduct({ name: 'Neither' });

    const report = await openBoardsForVialProducts();

    expect(report.eligible).toBe(3);
    expect(report.kahatiOpened).toBe(2);
    expect(report.groupBuyOpened).toBe(1);
  });

  it('writes only the switches, leaving the group buy terms exactly as they were', async () => {
    await seedProduct({
      name: 'Retatrutide',
      gbPricePerKitPhp: '5000', gbPricePerPiecePhp: '500',
      gbVialsPerKit: 10, gbMinVials: 2, gbMaxVialsPerBatch: 8,
    });

    await openBoardsForVialProducts();

    const db = await getDb();
    const [row] = await db.select().from(products);
    expect(row.gbPricePerKitPhp).toBe('5000.00');
    expect(row.gbPricePerPiecePhp).toBe('500.00');
    expect(row.gbVialsPerKit).toBe(10);
    expect(row.gbMinVials).toBe(2);
    expect(row.gbMaxVialsPerBatch).toBe(8);
    expect(row.pricePhp).toBe('5688.00');
  });

  it('changes nothing on a re-run', async () => {
    await seedProduct({ name: 'Retatrutide' });
    await seedProduct({ name: 'Tirzepatide' });

    await openBoardsForVialProducts();
    const second = await openBoardsForVialProducts();

    expect(second.eligible).toBe(2);
    expect(second.kahatiOpened).toBe(0);
    expect(second.groupBuyOpened).toBe(0);
  });

  it('reports the numbers without writing under dryRun', async () => {
    await seedProduct({ name: 'Retatrutide' });
    await seedProduct({ name: 'Tirzepatide' });

    const report = await openBoardsForVialProducts({ dryRun: true });

    expect(report.kahatiOpened).toBe(2);
    expect(report.groupBuyOpened).toBe(2);
    expect(report.applied).toBe(false);

    const db = await getDb();
    const rows = await db.select().from(products);
    expect(rows.every((r) => !r.isKahati && !r.isGroupBuy)).toBe(true);
  });

  it('names the rows it refused for want of a price, so the gap stays visible', async () => {
    await seedProduct({ name: 'ACETIC ACID', spec: '5ML', pricePhp: '0' });

    const report = await openBoardsForVialProducts({ dryRun: true });

    expect(report.skippedUnpriced).toEqual(['ACETIC ACID 5ML']);
  });

  it('ticks a delisted product too, so relisting it does not need a second run', async () => {
    // is_active governs whether the SHOP lists the product; the switches govern
    // whether a board MAY carry it. Both seeders refuse a delisted row, so
    // nothing lists until it comes back.
    await seedProduct({ name: 'Retired peptide', isActive: false });

    const report = await openBoardsForVialProducts();

    expect(report.kahatiOpened).toBe(1);
    const db = await getDb();
    const [row] = await db.select().from(products);
    expect(row.isKahati).toBe(true);
    expect(row.isActive).toBe(false);
  });
});
