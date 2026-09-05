// A product edit reaching the listings it already opened — database side.
//
// The rules live in lib/listing-sync.ts; this is where they meet real rows. The
// questions that only a database can answer are WHICH listings an edit may
// touch — open ones for this product, and no others — and that a finished batch
// is history a later price correction must never rewrite.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, products, groupBuys, moqCampaigns } from '@/lib/db';
import { resetDb, makeProduct, makeGroupBuy } from '@/lib/test/harness';
import { syncListingsForProduct } from './listing-sync-server';
import type { IncludedProduct } from './types';

beforeEach(resetDb);

/** The catalog row itself — the shape both boards seed from. */
async function catalogRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row;
}

async function makeCampaign(o: {
  name?: string; pricePerKitPhp?: number; moq?: number; committed?: number;
  status?: 'open' | 'approved' | 'completed' | 'cancelled';
  includedProducts: IncludedProduct[];
}) {
  const db = await getDb();
  const id = randomUUID();
  const [row] = await db.insert(moqCampaigns).values({
    id, seriesId: id, batchNo: 1,
    name: o.name ?? 'Retatrutide 20mg vial',
    pricePerKitPhp: String(o.pricePerKitPhp ?? 4800),
    moq: o.moq ?? 10, committed: o.committed ?? 0, perCustomerMin: 1,
    status: o.status ?? 'open',
    includedProducts: o.includedProducts,
  }).returning();
  return row;
}

describe('syncListingsForProduct — hatian counters', () => {
  it('reprices the open counter when the product’s group buy price changes', async () => {
    const p = await makeProduct({ isKahati: true, gbPricePerKitPhp: 4800 });
    const before = await catalogRow(p.id);
    await makeGroupBuy({ productId: p.id, pricePerKitPhp: 4800, totalSlots: 10 });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ gbPricePerKitPhp: '4000' }).where(eq(products.id, p.id)).returning();
    await syncListingsForProduct(db, before, after);

    const [counter] = await db.select().from(groupBuys).where(eq(groupBuys.productId, p.id));
    expect(counter.pricePerKitPhp).toBe('4000.00');
  });

  it('renames the counter when the product is renamed', async () => {
    const p = await makeProduct({ isKahati: true, name: 'Retatrutide', spec: '20mg vial' });
    const before = await catalogRow(p.id);
    await makeGroupBuy({ productId: p.id, name: 'Retatrutide 20mg vial' });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ name: 'Retatrutide (Salt Form)' }).where(eq(products.id, p.id)).returning();
    await syncListingsForProduct(db, before, after);

    const [counter] = await db.select().from(groupBuys).where(eq(groupBuys.productId, p.id));
    expect(counter.name).toBe('Retatrutide (Salt Form) 20mg vial');
  });

  it('leaves a finished counter at the price its joiners agreed to', async () => {
    const p = await makeProduct({ isKahati: true, gbPricePerKitPhp: 4800 });
    const before = await catalogRow(p.id);
    // Not 'open': its kit is ordered and its participants are settling up.
    const closed = await makeGroupBuy({ productId: p.id, pricePerKitPhp: 4800, status: 'closed' });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ gbPricePerKitPhp: '4000' }).where(eq(products.id, p.id)).returning();
    await syncListingsForProduct(db, before, after);

    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, closed.id));
    expect(row.pricePerKitPhp).toBe('4800.00');
  });

  it('leaves another product’s counter alone', async () => {
    const mine = await makeProduct({ isKahati: true, gbPricePerKitPhp: 4800, name: 'Retatrutide' });
    const other = await makeProduct({ isKahati: true, gbPricePerKitPhp: 2400, name: 'GHK-Cu' });
    const before = await catalogRow(mine.id);
    const otherCounter = await makeGroupBuy({ productId: other.id, pricePerKitPhp: 2400 });
    await makeGroupBuy({ productId: mine.id, pricePerKitPhp: 4800 });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ gbPricePerKitPhp: '4000' }).where(eq(products.id, mine.id)).returning();
    await syncListingsForProduct(db, before, after);

    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, otherCounter.id));
    expect(row.pricePerKitPhp).toBe('2400.00');
  });

  it('narrows the vial cap only as far as the vials already claimed allow', async () => {
    const p = await makeProduct({ isKahati: true, gbMaxVialsPerBatch: 10 });
    const before = await catalogRow(p.id);
    await makeGroupBuy({ productId: p.id, totalSlots: 10, claimedSlots: 6 });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ gbMaxVialsPerBatch: 3 }).where(eq(products.id, p.id)).returning();
    await syncListingsForProduct(db, before, after);

    const [counter] = await db.select().from(groupBuys).where(eq(groupBuys.productId, p.id));
    // 6/3 is a row the database refuses outright; 6/6 is the honest narrowing.
    expect(counter.totalSlots).toBe(6);
    expect(counter.claimedSlots).toBe(6);
  });
});

describe('syncListingsForProduct — campaign batches', () => {
  it('reprices and renames the open batch that carries only this product', async () => {
    const p = await makeProduct({ isGroupBuy: true, gbPricePerKitPhp: 6600, name: 'Cagrilintide', spec: '5mg' });
    const before = await catalogRow(p.id);
    const batch = await makeCampaign({
      name: 'Cagrilintide 5mg', pricePerKitPhp: 6600,
      includedProducts: [{ productId: p.id, name: 'Cagrilintide', outOfStock: false }],
    });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ gbPricePerKitPhp: '6000', name: 'Cagrilintide (Salt Form)' })
      .where(eq(products.id, p.id)).returning();
    await syncListingsForProduct(db, before, after);

    const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, batch.id));
    expect(row.pricePerKitPhp).toBe('6000.00');
    expect(row.name).toBe('Cagrilintide (Salt Form) 5mg');
    expect(row.includedProducts).toEqual([
      { productId: p.id, name: 'Cagrilintide (Salt Form)', outOfStock: false },
    ]);
  });

  it('relabels the product inside a mixed batch without renaming or repricing it', async () => {
    const p = await makeProduct({ isGroupBuy: true, gbPricePerKitPhp: 6600, name: 'Cagrilintide' });
    const other = await makeProduct({ isGroupBuy: true, name: 'Tirzepatide' });
    const before = await catalogRow(p.id);
    const batch = await makeCampaign({
      name: 'Salt form bundle', pricePerKitPhp: 12000,
      includedProducts: [
        { productId: p.id, name: 'Cagrilintide', outOfStock: false },
        { productId: other.id, name: 'Tirzepatide', outOfStock: false },
      ],
    });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ gbPricePerKitPhp: '6000', name: 'Cagrilintide (Salt Form)' })
      .where(eq(products.id, p.id)).returning();
    await syncListingsForProduct(db, before, after);

    const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, batch.id));
    expect(row.name).toBe('Salt form bundle');
    expect(row.pricePerKitPhp).toBe('12000.00');
    expect(row.includedProducts).toEqual([
      { productId: p.id, name: 'Cagrilintide (Salt Form)', outOfStock: false },
      { productId: other.id, name: 'Tirzepatide', outOfStock: false },
    ]);
  });

  it('leaves a batch that is no longer open at the price it was approved on', async () => {
    const p = await makeProduct({ isGroupBuy: true, gbPricePerKitPhp: 6600 });
    const before = await catalogRow(p.id);
    const batch = await makeCampaign({
      status: 'approved', pricePerKitPhp: 6600,
      includedProducts: [{ productId: p.id, name: 'Cagrilintide', outOfStock: false }],
    });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ gbPricePerKitPhp: '6000' }).where(eq(products.id, p.id)).returning();
    await syncListingsForProduct(db, before, after);

    const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, batch.id));
    expect(row.pricePerKitPhp).toBe('6600.00');
  });

  it('never drops the MOQ below the kits already committed', async () => {
    const p = await makeProduct({ isGroupBuy: true, gbMaxVialsPerBatch: 100 });
    const before = await catalogRow(p.id);
    const batch = await makeCampaign({
      moq: 10, committed: 7,
      includedProducts: [{ productId: p.id, name: 'Retatrutide', outOfStock: false }],
    });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ gbMaxVialsPerBatch: 20 }).where(eq(products.id, p.id)).returning();
    await syncListingsForProduct(db, before, after);

    const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, batch.id));
    expect(row.moq).toBe(7);
  });
});

describe('syncListingsForProduct — report', () => {
  it('counts the listings it changed on both boards', async () => {
    const p = await makeProduct({ isGroupBuy: true, isKahati: true, gbPricePerKitPhp: 4800 });
    const before = await catalogRow(p.id);
    await makeGroupBuy({ productId: p.id, pricePerKitPhp: 4800 });
    await makeCampaign({
      pricePerKitPhp: 4800,
      includedProducts: [{ productId: p.id, name: 'Test Peptide', outOfStock: false }],
    });

    const db = await getDb();
    const [after] = await db.update(products)
      .set({ gbPricePerKitPhp: '4000' }).where(eq(products.id, p.id)).returning();

    expect(await syncListingsForProduct(db, before, after)).toEqual({ kahatis: 1, campaigns: 1 });
  });

  it('writes nothing when the edit moved no detail either board shows', async () => {
    const p = await makeProduct({ isGroupBuy: true, isKahati: true, gbPricePerKitPhp: 4800 });
    const before = await catalogRow(p.id);
    await makeGroupBuy({ productId: p.id, pricePerKitPhp: 4800 });
    await makeCampaign({
      pricePerKitPhp: 4800,
      includedProducts: [{ productId: p.id, name: 'Test Peptide', outOfStock: false }],
    });

    const db = await getDb();
    // Stock is not a board detail. Restocking must not touch either listing.
    const [after] = await db.update(products)
      .set({ stock: 250 }).where(eq(products.id, p.id)).returning();

    expect(await syncListingsForProduct(db, before, after)).toEqual({ kahatis: 0, campaigns: 0 });
  });
});
