// Taking the mispriced campaigns off the board so correctly priced ones replace them.
//
// Seeded campaigns were listed at the product's shop price TIMES the kit size,
// on the belief that `products.price_php` was a per-vial figure. It is not — the
// source workbook heads that column "PER KIT (10 VIALS) PRICE" — so every seeded
// campaign read ten times its real price. lib/campaign-seed.ts no longer makes
// that mistake, but a campaign already on the board keeps the price it was
// opened with. This is the operation that clears them out.
//
// It cancels rather than edits, because that is the lifecycle the board already
// has: cancelling closes the batch and openCampaignsForGroupBuyProducts then
// opens a fresh one at the corrected price. Two existing, tested paths instead
// of a new in-place price mutation.
//
// The guard that matters: a batch holding commitments is NEVER cancelled.
// applyCampaignAction's cancel is a bare status flip with no order-release flow
// (unlike a hatian's), so cancelling a committed batch would strand real
// customer orders. Those are reported by name and left for a human.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, products, categories, moqCampaigns } from '@/lib/db';
import { resetDb } from '@/lib/test/harness';
import { cancelMispricedCampaigns } from './campaign-reprice';
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

// A campaign as the old, buggy seeder would have written it: shop price x kit size.
async function seedCampaign(
  productId: string,
  overrides: Partial<typeof moqCampaigns.$inferInsert> = {},
) {
  const db = await getDb();
  const [row] = await db.insert(moqCampaigns).values({
    name: 'Retatrutide 20mg vial',
    pricePerKitPhp: '9000',
    moq: 10,
    perCustomerMin: 1,
    status: 'open',
    includedProducts: [{ productId, name: 'Retatrutide', outOfStock: false }],
    ...overrides,
  }).returning();
  return row;
}

describe('cancelMispricedCampaigns', () => {
  it('cancels an open campaign carrying the pre-fix kit-size multiple', async () => {
    const p = await seedProduct({ pricePhp: '900' });
    const c = await seedCampaign(p.id, { pricePerKitPhp: '9000' });

    const report = await cancelMispricedCampaigns();

    expect(report.mispriced).toBe(1);
    expect(report.cancelled).toBe(1);
    const db = await getDb();
    const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, c.id));
    expect(row.status).toBe('cancelled');
  });

  it('leaves a campaign that already reads the correct price', async () => {
    const p = await seedProduct({ pricePhp: '900' });
    await seedCampaign(p.id, { pricePerKitPhp: '900' });

    const report = await cancelMispricedCampaigns();

    expect(report.mispriced).toBe(0);
    expect(report.cancelled).toBe(0);
    const db = await getDb();
    expect((await db.select().from(moqCampaigns))[0].status).toBe('open');
  });

  it('leaves a price an admin set by hand, which is the group buy discount', async () => {
    const p = await seedProduct({ pricePhp: '900' });
    await seedCampaign(p.id, { pricePerKitPhp: '750' });

    const report = await cancelMispricedCampaigns();

    expect(report.cancelled).toBe(0);
    const db = await getDb();
    expect((await db.select().from(moqCampaigns))[0].status).toBe('open');
  });

  it("uses the product's own kit size, not a hardcoded ten", async () => {
    const p = await seedProduct({ pricePhp: '900', gbVialsPerKit: 5 });
    await seedCampaign(p.id, { pricePerKitPhp: '4500' });

    const report = await cancelMispricedCampaigns();

    expect(report.cancelled).toBe(1);
  });

  it('refuses to cancel a mispriced batch holding commitments, and names it', async () => {
    const p = await seedProduct({ pricePhp: '900' });
    const c = await seedCampaign(p.id, { pricePerKitPhp: '9000', committed: 3 });

    const report = await cancelMispricedCampaigns();

    expect(report.cancelled).toBe(0);
    expect(report.skippedCommitted).toEqual(['Retatrutide 20mg vial']);
    const db = await getDb();
    const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, c.id));
    expect(row.status).toBe('open');
  });

  it('leaves batches that are not open, whatever they are priced at', async () => {
    const p = await seedProduct({ pricePhp: '900' });
    await seedCampaign(p.id, { pricePerKitPhp: '9000', status: 'completed' });

    const report = await cancelMispricedCampaigns();

    expect(report.cancelled).toBe(0);
    const db = await getDb();
    expect((await db.select().from(moqCampaigns))[0].status).toBe('completed');
  });

  it('leaves a campaign whose product cannot be resolved', async () => {
    const db = await getDb();
    await db.insert(moqCampaigns).values({
      name: 'Free-text campaign', pricePerKitPhp: '9000', status: 'open',
      includedProducts: [],
    });

    const report = await cancelMispricedCampaigns();

    expect(report.cancelled).toBe(0);
    expect((await db.select().from(moqCampaigns))[0].status).toBe('open');
  });

  it('writes nothing under a dry run but still reports what it would do', async () => {
    const p = await seedProduct({ pricePhp: '900' });
    await seedCampaign(p.id, { pricePerKitPhp: '9000' });

    const report = await cancelMispricedCampaigns({ dryRun: true });

    expect(report.mispriced).toBe(1);
    expect(report.applied).toBe(false);
    const db = await getDb();
    expect((await db.select().from(moqCampaigns))[0].status).toBe('open');
  });

  it('is idempotent: a second run finds nothing left to cancel', async () => {
    const p = await seedProduct({ pricePhp: '900' });
    await seedCampaign(p.id, { pricePerKitPhp: '9000' });

    await cancelMispricedCampaigns();
    const report = await cancelMispricedCampaigns();

    expect(report.cancelled).toBe(0);
  });
});

describe('cancel then reopen — the whole point of the operation', () => {
  it('relists the product at the corrected price', async () => {
    const p = await seedProduct({ name: 'Tirzepatide', spec: '15mg vial', pricePhp: '3200' });
    await seedCampaign(p.id, { name: 'Tirzepatide 15mg vial', pricePerKitPhp: '32000' });

    await cancelMispricedCampaigns();
    const opened = await openCampaignsForGroupBuyProducts();

    expect(opened.created).toBe(1);
    const db = await getDb();
    const live = (await db.select().from(moqCampaigns)).filter((c) => c.status === 'open');
    expect(live).toHaveLength(1);
    expect(live[0].pricePerKitPhp).toBe('3200.00');
  });

  it('does not relist a product whose committed batch was rightly left alone', async () => {
    // The old batch is still open, so the product is still on the board and the
    // seeder must not open a second, cheaper batch competing with it.
    const p = await seedProduct({ pricePhp: '900' });
    await seedCampaign(p.id, { pricePerKitPhp: '9000', committed: 3 });

    await cancelMispricedCampaigns();
    const opened = await openCampaignsForGroupBuyProducts();

    expect(opened.created).toBe(0);
  });
});
