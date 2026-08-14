import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql, eq } from 'drizzle-orm';
import { getDb, orders } from '@/lib/db';
import { makeUser, resetDb } from '@/lib/test/harness';

const migrationPath = fileURLToPath(
  new URL('../../drizzle/0022_backfill_kahati_packing_fee_totals.sql', import.meta.url),
);

async function runBackfill() {
  const db = await getDb();
  const statements = readFileSync(migrationPath, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await db.execute(sql.raw(statement));
}

async function legacyOrder(overrides: Partial<typeof orders.$inferInsert> = {}) {
  const user = await makeUser();
  const db = await getDb();
  const [order] = await db.insert(orders).values({
    orderNo: `KH-${Math.random().toString(36).slice(2, 8)}`,
    userId: user.id,
    buyType: 'kahati',
    subtotalPhp: '5862.50',
    packingFeePhp: '0',
    totalPhp: '5862.50',
    downpaymentPhp: '150',
    shipName: 'Ana Reyes',
    shipPhone: '0917 555 2210',
    shipAddress: 'Cavite',
    ...overrides,
  }).returning();
  return order;
}

describe('0022 kahati packing-fee total backfill', () => {
  it('moves legacy kahati downpayments into packing fee and adds them on top', async () => {
    await resetDb();
    const order = await legacyOrder();

    await runBackfill();

    const [row] = await (await getDb()).select().from(orders).where(eq(orders.id, order.id));
    expect(Number(row.subtotalPhp)).toBe(5862.5);
    expect(Number(row.packingFeePhp)).toBe(150);
    expect(Number(row.totalPhp)).toBe(6012.5);
    expect(Number(row.downpaymentPhp)).toBe(150);
  });

  it('leaves already-correct and waived-fee rows alone', async () => {
    await resetDb();
    const correct = await legacyOrder({ packingFeePhp: '150', totalPhp: '6012.50' });
    const waived = await legacyOrder({ orderNo: 'KH-waived', totalPhp: '5862.50', downpaymentPhp: '0' });

    await runBackfill();

    const rows = await (await getDb()).select().from(orders);
    const byId = new Map(rows.map((o) => [o.id, o]));
    expect(Number(byId.get(correct.id)!.packingFeePhp)).toBe(150);
    expect(Number(byId.get(correct.id)!.totalPhp)).toBe(6012.5);
    expect(Number(byId.get(waived.id)!.packingFeePhp)).toBe(0);
    expect(Number(byId.get(waived.id)!.totalPhp)).toBe(5862.5);
  });
});
