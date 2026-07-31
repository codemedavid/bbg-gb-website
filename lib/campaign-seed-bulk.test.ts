// Opening a Group Buy campaign for every product that is flagged for one.
//
// /groupbuy renders campaigns, never products (app/api/campaigns/route.ts reads
// moq_campaigns). So `products.is_group_buy` — a permission, not a listing —
// could be true on all 95 rows and the board would still show one card. This is
// the operation that turns the permission into listings, by opening batch #1 of
// a series per product.
//
// It reuses every existing path rather than adding a second one: the card, the
// cart line, checkout, batching and the admin screens all already work on a
// campaign. The product is linked through `included_products`, which is the link
// the admin form has always written — no new column, no migration.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, products, categories, moqCampaigns } from '@/lib/db';
import { resetDb, makeMoqCampaign } from '@/lib/test/harness';
import { openCampaignsForGroupBuyProducts } from './campaign-seed-bulk';

beforeEach(resetDb);

async function seedProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
  const db = await getDb();
  const [cat] = await db.insert(categories).values({
    name: 'Peptides', slug: `peptides-${Math.random().toString(36).slice(2, 8)}`,
  }).returning();
  const [row] = await db.insert(products).values({
    name: 'Retatrutide', spec: '20mg vial', categoryId: cat.id,
    pricePhp: '900', stock: 100, isActive: true, isGroupBuy: true,
    ...overrides,
  }).returning();
  return row;
}

describe('openCampaignsForGroupBuyProducts', () => {
  it('opens one campaign per flagged product, so the board lists them', async () => {
    await seedProduct({ name: 'Retatrutide' });
    await seedProduct({ name: 'Tirzepatide' });
    await seedProduct({ name: 'Semaglutide' });

    const report = await openCampaignsForGroupBuyProducts();

    expect(report.created).toBe(3);
    const db = await getDb();
    const rows = await db.select().from(moqCampaigns);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'open')).toBe(true);
  });

  it('prices each campaign from the product, falling back to the shop price', async () => {
    await seedProduct({ name: 'Priced', gbPricePerKitPhp: '7500', pricePhp: '900' });
    await seedProduct({ name: 'Unpriced', pricePhp: '900' });

    await openCampaignsForGroupBuyProducts();

    const db = await getDb();
    const rows = await db.select().from(moqCampaigns);
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get('Priced 20mg vial')!.pricePerKitPhp).toBe('7500.00');
    expect(byName.get('Unpriced 20mg vial')!.pricePerKitPhp).toBe('9000.00');
  });

  it('links the product through includedProducts, which is how the board finds it', async () => {
    const p = await seedProduct({ name: 'Retatrutide' });

    await openCampaignsForGroupBuyProducts();

    const db = await getDb();
    const [row] = await db.select().from(moqCampaigns);
    expect(row.includedProducts).toEqual([
      { productId: p.id, name: 'Retatrutide', outOfStock: false },
    ]);
  });

  it('opens each campaign as batch #1 of its own series', async () => {
    await seedProduct();

    await openCampaignsForGroupBuyProducts();

    const db = await getDb();
    const [row] = await db.select().from(moqCampaigns);
    expect(row.batchNo).toBe(1);
    expect(row.seriesId).toBe(row.id);
  });

  it('ignores a product that is not flagged for group buy', async () => {
    await seedProduct({ name: 'Flagged', isGroupBuy: true });
    await seedProduct({ name: 'Not flagged', isGroupBuy: false });

    const report = await openCampaignsForGroupBuyProducts();

    expect(report.created).toBe(1);
    const db = await getDb();
    const rows = await db.select().from(moqCampaigns);
    expect(rows[0].name).toBe('Flagged 20mg vial');
  });

  it('ignores a delisted product — the shop does not sell it, so the board must not', async () => {
    await seedProduct({ name: 'Delisted', isActive: false });

    const report = await openCampaignsForGroupBuyProducts();

    expect(report.created).toBe(0);
    expect(report.scanned).toBe(0);
  });

  it('skips a product that already has a live campaign — the operation is idempotent', async () => {
    await seedProduct({ name: 'Retatrutide' });
    await seedProduct({ name: 'Tirzepatide' });

    await openCampaignsForGroupBuyProducts();
    const second = await openCampaignsForGroupBuyProducts();

    expect(second.created).toBe(0);
    expect(second.skippedExisting).toBe(2);
    const db = await getDb();
    expect(await db.select().from(moqCampaigns)).toHaveLength(2);
  });

  it('does not open a duplicate for a product an admin already listed by hand', async () => {
    const p = await seedProduct({ name: 'Retatrutide' });
    const existing = await makeMoqCampaign();
    const db = await getDb();
    await db.update(moqCampaigns)
      .set({ includedProducts: [{ productId: p.id, name: 'Retatrutide', outOfStock: false }] })
      .where(eq(moqCampaigns.id, existing.id));

    const report = await openCampaignsForGroupBuyProducts();

    expect(report.created).toBe(0);
    expect(report.skippedExisting).toBe(1);
    expect(await db.select().from(moqCampaigns)).toHaveLength(1);
  });

  it('re-lists a product whose only campaign was cancelled', async () => {
    // A cancelled batch is over. Leaving the product unlisted forever would mean
    // one cancellation permanently removes it from the board.
    const p = await seedProduct({ name: 'Retatrutide' });
    const dead = await makeMoqCampaign({ status: 'cancelled' });
    const db = await getDb();
    await db.update(moqCampaigns)
      .set({ includedProducts: [{ productId: p.id, name: 'Retatrutide', outOfStock: false }] })
      .where(eq(moqCampaigns.id, dead.id));

    const report = await openCampaignsForGroupBuyProducts();

    expect(report.created).toBe(1);
  });

  it('refuses to list a product it cannot price, and reports it instead', async () => {
    await seedProduct({ name: 'Free?', pricePhp: '0' });

    const report = await openCampaignsForGroupBuyProducts();

    expect(report.created).toBe(0);
    expect(report.skippedUnpriced).toEqual(['Free? 20mg vial']);
    const db = await getDb();
    expect(await db.select().from(moqCampaigns)).toHaveLength(0);
  });

  it('writes nothing under dryRun but reports what it would open', async () => {
    await seedProduct({ name: 'Retatrutide' });
    await seedProduct({ name: 'Tirzepatide' });

    const report = await openCampaignsForGroupBuyProducts({ dryRun: true });

    expect(report.scanned).toBe(2);
    expect(report.created).toBe(2);
    expect(report.applied).toBe(false);
    const db = await getDb();
    expect(await db.select().from(moqCampaigns)).toHaveLength(0);
  });

  it('reports an empty catalog as nothing to do rather than failing', async () => {
    const report = await openCampaignsForGroupBuyProducts();
    expect(report).toMatchObject({ scanned: 0, created: 0, skippedExisting: 0, applied: true });
  });
});
