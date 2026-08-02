// Opening a Hatian counter for every product that is flagged for a group buy.
//
// The mirror of lib/campaign-seed-bulk.test.ts. /groupbuys renders rows of
// `group_buys` and nothing else (app/api/groupbuys/route.ts), so — exactly as on
// the campaign board — flagging 95 products lists nothing by itself. This is the
// operation that turns the permission into counters.
//
// Idempotency is by the product link: a product already carrying an OPEN counter
// is left alone. Closed and cancelled counters do not count, because that batch
// is over and one finished hatian must not delist a product forever.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, products, categories, groupBuys } from '@/lib/db';
import { resetDb } from '@/lib/test/harness';
import { openKahatisForGroupBuyProducts } from './kahati-seed-bulk';

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

describe('openKahatisForGroupBuyProducts', () => {
  it('opens one counter per flagged product, so the hatian board lists them', async () => {
    await seedProduct({ name: 'Retatrutide' });
    await seedProduct({ name: 'Tirzepatide' });
    await seedProduct({ name: 'Semaglutide' });

    const report = await openKahatisForGroupBuyProducts();

    expect(report.created).toBe(3);
    const db = await getDb();
    const rows = await db.select().from(groupBuys);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'open')).toBe(true);
    expect(rows.every((r) => r.claimedSlots === 0)).toBe(true);
  });

  it('prices each counter from the product, falling back to the shop price as-is', async () => {
    await seedProduct({ name: 'Priced', gbPricePerKitPhp: '7500', pricePhp: '900' });
    await seedProduct({ name: 'Unpriced', pricePhp: '900' });

    await openKahatisForGroupBuyProducts();

    const db = await getDb();
    const byName = new Map((await db.select().from(groupBuys)).map((r) => [r.name, r]));
    expect(byName.get('Priced 20mg vial')!.pricePerKitPhp).toBe('7500.00');
    // Already a per-kit figure — never multiplied by the kit size.
    expect(byName.get('Unpriced 20mg vial')!.pricePerKitPhp).toBe('900.00');
  });

  it('links the product, which is how a counter is traced back to the catalog', async () => {
    const p = await seedProduct();
    await openKahatisForGroupBuyProducts();

    const db = await getDb();
    const [row] = await db.select().from(groupBuys);
    expect(row.productId).toBe(p.id);
  });

  it('leaves a product that already has an open counter alone', async () => {
    await seedProduct();
    await openKahatisForGroupBuyProducts();

    const report = await openKahatisForGroupBuyProducts();

    expect(report.created).toBe(0);
    expect(report.skippedExisting).toBe(1);
    const db = await getDb();
    expect(await db.select().from(groupBuys)).toHaveLength(1);
  });

  it('reopens a counter for a product whose previous one is over', async () => {
    const p = await seedProduct();
    await openKahatisForGroupBuyProducts();
    const db = await getDb();
    await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.productId, p.id));

    const report = await openKahatisForGroupBuyProducts();

    expect(report.created).toBe(1);
    expect(await db.select().from(groupBuys)).toHaveLength(2);
  });

  it('skips delisted products, because the shop does not sell them', async () => {
    await seedProduct({ isActive: false });

    const report = await openKahatisForGroupBuyProducts();

    expect(report.scanned).toBe(0);
    expect(report.created).toBe(0);
  });

  it('skips products that are not flagged for a group buy', async () => {
    await seedProduct({ isGroupBuy: false });

    const report = await openKahatisForGroupBuyProducts();

    expect(report.created).toBe(0);
  });

  it('names an unpriceable product rather than opening a free counter', async () => {
    await seedProduct({ name: 'Free', pricePhp: '0' });

    const report = await openKahatisForGroupBuyProducts();

    expect(report.created).toBe(0);
    expect(report.skippedUnpriced).toEqual(['Free 20mg vial']);
    const db = await getDb();
    expect(await db.select().from(groupBuys)).toHaveLength(0);
  });

  it('writes nothing under a dry run but still reports what it would do', async () => {
    await seedProduct();

    const report = await openKahatisForGroupBuyProducts({ dryRun: true });

    expect(report.created).toBe(1);
    expect(report.applied).toBe(false);
    const db = await getDb();
    expect(await db.select().from(groupBuys)).toHaveLength(0);
  });

  it('carries the arrival group so each counter ships with its own group', async () => {
    await seedProduct({ arrivalGroup: 'salt_liquid' });

    await openKahatisForGroupBuyProducts();

    const db = await getDb();
    const [row] = await db.select().from(groupBuys);
    expect(row.arrivalGroup).toBe('salt_liquid');
  });
});
