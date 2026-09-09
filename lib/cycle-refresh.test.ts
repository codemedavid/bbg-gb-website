// A new cycle re-reads every listing nobody joined from the catalog.
//
// Both boards seed a listing's terms from its product ONCE, when the listing
// opens. The cycle control then stepped around any listing nobody had joined —
// rightly, in that there is no batch to end — but "stepped around" meant left
// completely untouched, so such a listing survived every cycle still carrying
// the price it opened with. And because the seeders refuse to list a product
// that already carries an open listing, the next cycle could never replace it
// either: the survivor BLOCKED its own replacement.
//
// Production on 2026-09-09 is what that compounds into. The Kahati board
// carried 89 open counters, 63 of them left over from August, and 34 of the 87
// product-linked ones listed a price the catalog no longer said — Oxytocin 5mg
// offered at ₱2,000 against a catalog reading ₱2,263. Pressing "start a new
// cycle" changed none of them, because every one of them was empty.
//
// So an empty listing is no longer left alone. It is re-read from its product,
// in place: no successor is minted and no batch nobody joined is recorded —
// which is the whole reason it was skipped — but its terms come forward.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, groupBuys, moqCampaigns, products } from '@/lib/db';
import { resetDb, makeProduct, makeGroupBuy } from '@/lib/test/harness';
import { rollOpenKahatis } from './kahati-server';
import { rollOpenBatches } from './moq-batch-server';

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

/** Move the catalog under a listing, the way a price adjustment or an edit does. */
async function repriceProduct(id: string, pricePhp: number) {
  const db = await getDb();
  await db.update(products).set({ pricePhp: String(pricePhp) }).where(eq(products.id, id));
}

// Written straight through drizzle rather than through makeMoqCampaign: the
// link a campaign carries its product by is `included_products`, and that is
// the field under test, so the test states it rather than inheriting a default.
async function campaignFor(
  product: { id: string; name: string },
  overrides: Partial<typeof moqCampaigns.$inferInsert> = {},
) {
  const db = await getDb();
  const id = randomUUID();
  const [row] = await db.insert(moqCampaigns).values({
    id, seriesId: id, batchNo: 1,
    name: 'Stale Campaign Name', pricePerKitPhp: '9999',
    moq: 10, committed: 0, perCustomerMin: 1, shippingPhp: '150',
    status: 'open', deadline: null,
    includedProducts: [{ productId: product.id, name: product.name, outOfStock: false }],
    ...overrides,
  }).returning();
  return row;
}

beforeEach(async () => {
  await resetDb();
});

describe('rollOpenKahatis — a cycle re-reads the counters nobody joined', () => {
  it('reprices an empty counter from its product', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000, claimedSlots: 0 });
    await repriceProduct(product.id, 2263);

    await rollOpenKahatis(db);

    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(2263);
  });

  // The counter is refreshed, not replaced. Minting a successor for a batch
  // nobody joined would record a batch that never ran and put an identical
  // empty row beside it — which is exactly why empty counters were skipped.
  it('leaves the counter row itself in place — same row, still open, still empty', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000 });
    await repriceProduct(product.id, 2263);

    await rollOpenKahatis(db);

    const all = await db.select().from(groupBuys);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(counter.id);
    expect(all[0].status).toBe('open');
    expect(all[0].claimedSlots).toBe(0);
  });

  it('renames an empty counter when the catalog renamed the product', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, name: 'Oxytocin', spec: '5mg vial' });
    const counter = await makeGroupBuy({ productId: product.id, name: 'Oxytocin 5mg' });
    await db.update(products).set({ name: 'Oxytocin', spec: '5mg vial (saltform)' })
      .where(eq(products.id, product.id));

    await rollOpenKahatis(db);

    expect((await loadCounter(counter.id)).name).toBe('Oxytocin 5mg vial (saltform)');
  });

  it('reapplies the cap and the per-person minimum the product now states', async () => {
    const db = await getDb();
    const product = await makeProduct({
      isKahati: true, gbMaxVialsPerBatch: 10, gbMinVials: 1,
    });
    const counter = await makeGroupBuy({ productId: product.id, totalSlots: 10, minVials: 1 });
    await db.update(products).set({ gbMaxVialsPerBatch: 8, gbMinVials: 2 })
      .where(eq(products.id, product.id));

    await rollOpenKahatis(db);

    const row = await loadCounter(counter.id);
    expect(row.totalSlots).toBe(8);
    expect(row.minVials).toBe(2);
  });

  it('reports how many counters it refreshed', async () => {
    const db = await getDb();
    const a = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const b = await makeProduct({ isKahati: true, pricePhp: 3000 });
    await makeGroupBuy({ productId: a.id, pricePerKitPhp: 2000 });
    await makeGroupBuy({ productId: b.id, pricePerKitPhp: 3000 });
    await repriceProduct(a.id, 2263);
    await repriceProduct(b.id, 3063);

    const result = await rollOpenKahatis(db);

    expect(result.refreshed).toBe(2);
    expect(result.rolled).toHaveLength(0);
  });

  // A counter already carrying the catalog's terms has nothing to bring
  // forward, so the cycle must not report work it did not do.
  it('counts nothing when a counter already matches its product', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000, totalSlots: 10, minVials: 1 });

    expect((await rollOpenKahatis(db)).refreshed).toBe(0);
  });

  // A joined counter is a running batch. It ends and reopens as it always did —
  // the refresh is for listings, not for batches people are committed to.
  it('rolls a counter that has vials on it rather than refreshing it', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000, claimedSlots: 3 });
    await repriceProduct(product.id, 2263);

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(1);
    expect(result.refreshed).toBe(0);
    // Sealed at the price its joiners agreed to, not at today's.
    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(2000);
  });

  // A free-text counter is one an admin typed by hand. Nothing in the catalog
  // speaks for it, so the cycle has nothing to re-read it from.
  it('leaves a counter with no product link alone', async () => {
    const db = await getDb();
    const counter = await makeGroupBuy({ productId: null, name: 'Hand-made counter', pricePerKitPhp: 4321 });

    const result = await rollOpenKahatis(db);

    expect(result.refreshed).toBe(0);
    const row = await loadCounter(counter.id);
    expect(row.name).toBe('Hand-made counter');
    expect(Number(row.pricePerKitPhp)).toBe(4321);
  });

  // seededKitPrice refuses to open a counter it cannot price. A refresh must
  // refuse for the same reason: a free kit on a public board is worse than a
  // stale one.
  it('never writes a price it cannot derive, leaving the counter as it was', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 0, gbPricePerKitPhp: null });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000 });

    const result = await rollOpenKahatis(db);

    expect(result.refreshed).toBe(0);
    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(2000);
  });
});

describe('rollOpenBatches — the same, on the Group Buy board', () => {
  it('reprices an empty batch from its included product', async () => {
    const db = await getDb();
    const product = await makeProduct({ isGroupBuy: true, name: 'NAD+', spec: '500mg vial', pricePhp: 3350 });
    const batch = await campaignFor({ id: product.id, name: 'NAD+' });

    await rollOpenBatches(db);

    expect(Number((await loadBatch(batch.id)).pricePerKitPhp)).toBe(3350);
  });

  it('renames an empty batch to what the catalog calls the product', async () => {
    const db = await getDb();
    const product = await makeProduct({ isGroupBuy: true, name: 'NAD+', spec: '500mg vial', pricePhp: 3350 });
    const batch = await campaignFor({ id: product.id, name: 'NAD+' });

    await rollOpenBatches(db);

    expect((await loadBatch(batch.id)).name).toBe('NAD+ 500mg vial');
  });

  // Pins the rule the refresh must not break: an empty batch is brought
  // forward, never sealed and succeeded.
  it('mints no successor for an empty batch', async () => {
    const db = await getDb();
    const product = await makeProduct({ isGroupBuy: true, pricePhp: 3350 });
    const batch = await campaignFor({ id: product.id, name: 'Test Peptide' });

    const result = await rollOpenBatches(db);

    expect(result.rolled).toHaveLength(0);
    expect(result.refreshed).toBe(1);
    const all = await db.select().from(moqCampaigns);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(batch.id);
    expect(all[0].batchNo).toBe(1);
    expect(all[0].status).toBe('open');
  });

  it('leaves a batch that carries no catalog product alone', async () => {
    const db = await getDb();
    const id = randomUUID();
    const [batch] = await db.insert(moqCampaigns).values({
      id, seriesId: id, batchNo: 1, name: 'Hand-made batch',
      pricePerKitPhp: '4321', moq: 10, committed: 0, perCustomerMin: 1,
      shippingPhp: '150', status: 'open', includedProducts: [],
    }).returning();

    const result = await rollOpenBatches(db);

    expect(result.refreshed).toBe(0);
    const row = await loadBatch(batch.id);
    expect(row.name).toBe('Hand-made batch');
    expect(Number(row.pricePerKitPhp)).toBe(4321);
  });
});
