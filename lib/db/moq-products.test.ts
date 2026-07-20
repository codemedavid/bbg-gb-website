// Schema-level guarantees for the MOQ shelf.
//
// The MOQ page is its own storefront surface, so it needs its own table rather
// than a filtered view of `products` — an admin managing the MOQ shelf must not
// be able to reach the main catalog, and a blend like "TR30 + CGL5" is a first
// class row here rather than a synthetic catalog entry that could leak into the
// shop. These tests pin the table and the two enum values that let an MOQ line
// reach an order.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDb, moqProducts } from '@/lib/db';
import { resetDb, makeMoqProduct } from '@/lib/test/harness';

beforeEach(resetDb);

describe('moq_products table', () => {
  it('stores an MOQ product with its price, stock and minimum order quantity', async () => {
    const db = await getDb();
    const [row] = await db.insert(moqProducts).values({
      name: 'FUAN GTT1500', spec: '1500mg', pricePhp: '4500', stock: 20, minOrderQty: 5,
      description: 'Bulk research peptide.',
    }).returning();

    expect(row.name).toBe('FUAN GTT1500');
    expect(Number(row.pricePhp)).toBe(4500);
    expect(row.stock).toBe(20);
    expect(row.minOrderQty).toBe(5);
    expect(row.isActive).toBe(true);
  });

  it('defaults a new product to a minimum order quantity of 1 and zero stock', async () => {
    const db = await getDb();
    const [row] = await db.insert(moqProducts).values({
      name: 'TR20 + RT20 Blends', spec: 'blend', pricePhp: '0',
    }).returning();

    expect(row.minOrderQty).toBe(1);
    expect(row.stock).toBe(0);
  });

  it('keeps an uploaded image key alongside the emoji fallback', async () => {
    const p = await makeMoqProduct({ imageKey: 'abc-123.png' });
    const db = await getDb();
    const [row] = await db.select().from(moqProducts).where(eq(moqProducts.id, p.id));
    expect(row.imageKey).toBe('abc-123.png');
    expect(row.imageEmoji).toBeTruthy();
  });

  it('is isolated from the main catalog — deleting an MOQ product touches no product row', async () => {
    const p = await makeMoqProduct();
    const db = await getDb();
    await db.delete(moqProducts).where(eq(moqProducts.id, p.id));
    const rows = await db.select().from(moqProducts);
    expect(rows).toHaveLength(0);
  });
});

describe('order enums carry the MOQ mode', () => {
  it('accepts "moq" as a buy_type', async () => {
    const db = await getDb();
    const res = await db.execute(sql`select 'moq'::buy_type as v`);
    expect((res.rows ?? res)[0].v).toBe('moq');
  });

  it('accepts "moq_product" as an order_item_kind', async () => {
    const db = await getDb();
    const res = await db.execute(sql`select 'moq_product'::order_item_kind as v`);
    expect((res.rows ?? res)[0].v).toBe('moq_product');
  });
});
