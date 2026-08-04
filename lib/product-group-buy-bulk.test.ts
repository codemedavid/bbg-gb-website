// Opening the Group Buy switch across the whole catalog, in one operation.
//
// The catalog reached 95 products with `is_group_buy = false` on every one of
// them, because the switch is per-product and nobody was going to tick it 95
// times. This is that tick, done once — and it has to be safe enough to run
// against production, which means three properties the tests below pin:
//
//   1. It writes ONLY the switch. A bulk UPDATE that also touched the group buy
//      terms would overwrite 95 products' pricing with defaults; a ₱0 kit reads
//      as free (see lib/db/schema.ts on the gb_* columns).
//   2. It is idempotent. A re-run after a partial failure must not double-count
//      or resurrect a switch an admin has since deliberately turned off.
//   3. It can be rehearsed. `dryRun` reports the exact number a real run would
//      change without writing, so the production run is a confirmation of a
//      number already seen rather than a surprise.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, products, categories } from '@/lib/db';
import { resetDb } from '@/lib/test/harness';
import { openGroupBuyForAllProducts } from './product-group-buy-bulk';

beforeEach(resetDb);

// A catalog row written straight in, so a test can start a product with the
// switch already on — which the shared harness's makeProduct cannot express.
async function seedProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
  const db = await getDb();
  const [cat] = await db.insert(categories).values({
    name: 'Peptides', slug: `peptides-${Math.random().toString(36).slice(2, 8)}`,
  }).returning();
  const [row] = await db.insert(products).values({
    name: 'Test Peptide', spec: '10mg', categoryId: cat.id,
    pricePhp: '3200', stock: 100, isActive: true,
    ...overrides,
  }).returning();
  return row;
}

describe('openGroupBuyForAllProducts', () => {
  it('turns the group buy switch on for every product in the catalog', async () => {
    await seedProduct({ name: 'Retatrutide 20mg' });
    await seedProduct({ name: 'Tirzepatide 10mg' });
    await seedProduct({ name: 'Semaglutide 5mg' });

    const report = await openGroupBuyForAllProducts();

    expect(report.scanned).toBe(3);
    expect(report.pending).toBe(3);
    expect(report.applied).toBe(true);

    const db = await getDb();
    const rows = await db.select({ isGroupBuy: products.isGroupBuy }).from(products);
    expect(rows.every((r) => r.isGroupBuy)).toBe(true);
  });

  it('counts a product whose switch is already on separately from the ones it opens', async () => {
    await seedProduct({ name: 'Already open', isGroupBuy: true });
    await seedProduct({ name: 'Still closed' });

    const report = await openGroupBuyForAllProducts();

    expect(report.scanned).toBe(2);
    expect(report.alreadyOpen).toBe(1);
    expect(report.pending).toBe(1);
  });

  it('opens nothing on a second run — the operation is idempotent', async () => {
    await seedProduct();
    await seedProduct();

    await openGroupBuyForAllProducts();
    const second = await openGroupBuyForAllProducts();

    expect(second.scanned).toBe(2);
    expect(second.alreadyOpen).toBe(2);
    expect(second.pending).toBe(0);
  });

  it('leaves the group buy terms untouched, so no product is repriced to a ₱0 kit', async () => {
    // One product with terms an admin typed, one with none. Neither may move:
    // absent terms mean "not configured" and fall back to the global defaults,
    // which is not the same as being written to zero.
    await seedProduct({
      name: 'Configured', gbPricePerKitPhp: '4500', gbPricePerPiecePhp: '480',
      gbVialsPerKit: 10, gbMinVials: 4, gbMaxVialsPerBatch: 100,
    });
    await seedProduct({ name: 'Unconfigured' });

    await openGroupBuyForAllProducts();

    const db = await getDb();
    const [configured] = await db.select().from(products).where(eq(products.name, 'Configured'));
    expect(configured.gbPricePerKitPhp).toBe('4500.00');
    expect(configured.gbPricePerPiecePhp).toBe('480.00');
    expect(configured.gbVialsPerKit).toBe(10);
    expect(configured.gbMinVials).toBe(4);
    expect(configured.gbMaxVialsPerBatch).toBe(100);

    const [unconfigured] = await db.select().from(products).where(eq(products.name, 'Unconfigured'));
    expect(unconfigured.gbPricePerKitPhp).toBeNull();
    expect(unconfigured.gbVialsPerKit).toBeNull();
    expect(unconfigured.gbMinVials).toBeNull();
  });

  it('leaves shop pricing, stock and the on-hand fields exactly as they were', async () => {
    await seedProduct({
      name: 'Sellable', pricePhp: '3200', priceUsd: '57.00', stock: 42,
      isOnHand: true, onHandKitPhp: '5000', onHandPiecePhp: '550', isActive: true,
    });

    await openGroupBuyForAllProducts();

    const db = await getDb();
    const [row] = await db.select().from(products).where(eq(products.name, 'Sellable'));
    expect(row.pricePhp).toBe('3200.00');
    expect(row.priceUsd).toBe('57.00');
    expect(row.stock).toBe(42);
    expect(row.isOnHand).toBe(true);
    expect(row.onHandKitPhp).toBe('5000.00');
    expect(row.onHandPiecePhp).toBe('550.00');
    expect(row.isActive).toBe(true);
  });

  it('opens a delisted product too — the switch is a catalog setting, not a listing', async () => {
    await seedProduct({ name: 'Delisted', isActive: false });

    const report = await openGroupBuyForAllProducts();

    expect(report.pending).toBe(1);
    const db = await getDb();
    const [row] = await db.select().from(products).where(eq(products.name, 'Delisted'));
    expect(row.isGroupBuy).toBe(true);
    expect(row.isActive).toBe(false);
  });

  it('reports what it would open without writing when dryRun is set', async () => {
    await seedProduct();
    await seedProduct({ isGroupBuy: true });

    const report = await openGroupBuyForAllProducts({ dryRun: true });

    expect(report.scanned).toBe(2);
    expect(report.alreadyOpen).toBe(1);
    expect(report.pending).toBe(1);
    expect(report.applied).toBe(false);

    const db = await getDb();
    const rows = await db.select({ isGroupBuy: products.isGroupBuy }).from(products);
    expect(rows.filter((r) => r.isGroupBuy)).toHaveLength(1);
  });

  it('reports an empty catalog as nothing to do rather than failing', async () => {
    const report = await openGroupBuyForAllProducts();

    expect(report).toMatchObject({ scanned: 0, alreadyOpen: 0, pending: 0, applied: true });
  });
});
