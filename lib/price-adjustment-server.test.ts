// Applying a price-adjustment workbook reaches the boards, not just the catalog.
//
// lib/listing-sync-server.ts exists precisely so a catalog edit reaches the
// listings it already opened — but only ONE caller ever used it, the
// single-product admin PATCH. The bulk path did not: scripts/price-adjustment.ts
// wrote products.price_php row by row and stopped there.
//
// So the batch-6 adjustment landed in the catalog and never reached the board.
// On 2026-09-09 that left 34 of the 87 product-linked Kahati counters offering a
// price the catalog no longer said, most of them off by the exact amount the
// workbook had moved them — MOTS-C 40mg listed at ₱11,562.50 against a catalog
// reading ₱9,963.
//
// The write and the sync are one operation, so they live in one function and
// this file is what holds them together.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, groupBuys, moqCampaigns, products } from '@/lib/db';
import { resetDb, makeProduct, makeGroupBuy } from '@/lib/test/harness';
import { applyPriceUpdates } from './price-adjustment-server';
import type { PriceUpdate } from './price-adjustment';

const update = (
  productId: string,
  fromPhp: number,
  toPhp: number,
  overrides: Partial<PriceUpdate> = {},
): PriceUpdate => ({
  row: 2, productId, name: 'Test Peptide', spec: '10mg', fromPhp, toPhp, ...overrides,
});

const loadProduct = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row;
};

const loadCounter = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row;
};

const loadBatch = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
  return row;
};

async function campaignFor(
  product: { id: string; name: string },
  overrides: Partial<typeof moqCampaigns.$inferInsert> = {},
) {
  const db = await getDb();
  const id = randomUUID();
  const [row] = await db.insert(moqCampaigns).values({
    id, seriesId: id, batchNo: 1, name: 'Test Peptide 10mg',
    pricePerKitPhp: '2000', moq: 10, committed: 0, perCustomerMin: 1,
    shippingPhp: '150', status: 'open',
    includedProducts: [{ productId: product.id, name: product.name, outOfStock: false }],
    ...overrides,
  }).returning();
  return row;
}

beforeEach(async () => {
  await resetDb();
});

describe('applyPriceUpdates', () => {
  it('writes the new price to the catalog', async () => {
    const db = await getDb();
    const product = await makeProduct({ pricePhp: 2000 });

    await applyPriceUpdates(db, [update(product.id, 2000, 2263)]);

    expect(Number((await loadProduct(product.id)).pricePhp)).toBe(2263);
  });

  it('carries the new price onto the product’s open Kahati counter', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000 });

    await applyPriceUpdates(db, [update(product.id, 2000, 2263)]);

    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(2263);
  });

  it('carries the new price onto the product’s open Group Buy batch', async () => {
    const db = await getDb();
    const product = await makeProduct({ isGroupBuy: true, pricePhp: 2000 });
    const batch = await campaignFor({ id: product.id, name: 'Test Peptide' });

    await applyPriceUpdates(db, [update(product.id, 2000, 2263)]);

    expect(Number((await loadBatch(batch.id)).pricePerKitPhp)).toBe(2263);
  });

  it('reports the catalog rows and the listings it moved', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000 });

    const report = await applyPriceUpdates(db, [update(product.id, 2000, 2263)]);

    expect(report.products).toBe(1);
    expect(report.kahatis).toBe(1);
    expect(report.campaigns).toBe(0);
  });

  // A closed counter's kit is ordered and its joiners are settling against a
  // price they already agreed to. Repricing it would rewrite what they owe.
  it('leaves a counter that is no longer open at the price it closed on', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({
      productId: product.id, pricePerKitPhp: 2000, claimedSlots: 8, status: 'closed',
    });

    await applyPriceUpdates(db, [update(product.id, 2000, 2263)]);

    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(2000);
  });

  // The shop price is only the FALLBACK a listing is seeded at. A product
  // carrying its own group buy price is listed at that, so moving the shop
  // price must not move the board.
  it('leaves a listing alone when the product prices the board separately', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000, gbPricePerKitPhp: 1800 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 1800 });

    await applyPriceUpdates(db, [update(product.id, 2000, 2263)]);

    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(1800);
  });

  it('applies every update it is given', async () => {
    const db = await getDb();
    const a = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const b = await makeProduct({ isKahati: true, pricePhp: 3000 });
    const counterA = await makeGroupBuy({ productId: a.id, pricePerKitPhp: 2000 });
    const counterB = await makeGroupBuy({ productId: b.id, pricePerKitPhp: 3000 });

    const report = await applyPriceUpdates(db, [
      update(a.id, 2000, 2263),
      update(b.id, 3000, 3063),
    ]);

    expect(report.products).toBe(2);
    expect(Number((await loadCounter(counterA.id)).pricePerKitPhp)).toBe(2263);
    expect(Number((await loadCounter(counterB.id)).pricePerKitPhp)).toBe(3063);
  });

  it('writes nothing when handed nothing', async () => {
    const db = await getDb();
    const report = await applyPriceUpdates(db, []);
    expect(report).toEqual({ products: 0, kahatis: 0, campaigns: 0 });
  });
});
