// A hatian line's Kits figure.
//
// A kahati order line is measured in VIALS and references a group buy, not a
// product — so the product join finds nothing, and the rollup used to fall back
// to one kit per vial. On the live board that made the two largest rows on the
// whole sheet read 109 kits and 20 kits where 10.9 and 2 were the truth: a 10x
// OVER-order of the most-ordered item in the week.
//
// The link exists now (group_buys.product_id), so a hatian line can reach the
// same kit size a direct order of that product would use. These tests pin the
// arithmetic end to end, because the pure builder cannot see the join that
// feeds it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const admin = { sub: 'admin', role: 'admin', email: 'a@b.c' };
  return {
    ApiError,
    getSession: async () => admin,
    requireSession: async () => admin,
    requireAdmin: async () => admin,
  };
});

const { GET } = await import('./route');
const { getDb, products, groupBuys, moqCampaigns, orders, orderItems } = await import('@/lib/db');
const { resetDb, makeUser } = await import('@/lib/test/harness');

const MONDAY = '2026-03-16';
const IN_WEEK = new Date('2026-03-17T02:00:00Z');

type Row = { name: string; qty: number; kits: number };

const rollup = async (): Promise<{ rows: Row[] }> => {
  const res = await GET(new Request(`http://localhost/api/admin/report/weekly?week=${MONDAY}`));
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data.report.productTotals;
};

// Throws rather than returning undefined: a missing row means the line never
// reached the rollup at all, and "cannot read kits of undefined" hides that.
function rowFor(totals: { rows: Row[] }, name: string): Row {
  const row = totals.rows.find((r) => r.name.includes(name));
  if (!row) throw new Error(`no rollup row matching "${name}" — got: ${totals.rows.map((r) => r.name).join(', ')}`);
  return row;
}

async function makeOrder() {
  const db = await getDb();
  const user = await makeUser();
  const [order] = await db.insert(orders).values({
    orderNo: `BBG-${Math.floor(Math.random() * 90000) + 10000}`,
    userId: user.id, status: 'payment_confirmed', subtotalPhp: '1000', totalPhp: '1000',
    shipName: 'Gelly', shipPhone: '0917', shipAddress: 'Manila', createdAt: IN_WEEK,
  }).returning();
  return order;
}

/** A hatian line for `qty` vials, on a counter that may or may not name a product. */
async function seedKahatiLine(
  qty: number,
  opts: { kitSize?: number | null; totalSlots?: number; name?: string } = {},
) {
  const db = await getDb();
  const order = await makeOrder();

  let productId: string | null = null;
  if (opts.kitSize != null) {
    const [product] = await db.insert(products).values({
      name: opts.name ?? 'KLOW 80mg', spec: '80mg vial', pricePhp: '9000',
      kitSize: opts.kitSize, stock: 0,
    }).returning();
    productId = product.id;
  }

  const [kahati] = await db.insert(groupBuys).values({
    name: opts.name ?? 'KLOW 80mg', pricePerKitPhp: '9000',
    totalSlots: opts.totalSlots ?? 10, claimedSlots: 0, minVials: 1,
    repackFeePhp: '150', status: 'open', productId,
  }).returning();

  await db.insert(orderItems).values({
    orderId: order.id, kind: 'group_buy', groupBuyId: kahati.id,
    nameSnapshot: `${opts.name ?? 'KLOW 80mg'} — kahati`, specSnapshot: 'per vial',
    unitPricePhp: '900', unitPriceUsd: '16', qty, lineTotalPhp: String(900 * qty),
  });
}

beforeEach(async () => {
  await resetDb();
});

describe('a hatian line reports the kits its supplier actually ships', () => {
  // The live regression, at its live numbers.
  it('reads 109 vials of a 10-vial-kit product as 10.9 kits, not 109', async () => {
    await seedKahatiLine(109, { kitSize: 10 });

    const row = rowFor(await rollup(), 'KLOW 80mg');

    expect(row.qty).toBe(109);
    expect(row.kits).toBeCloseTo(10.9, 5);
  });

  it('reads 20 vials as 2 kits', async () => {
    await seedKahatiLine(20, { kitSize: 10 });

    expect(rowFor(await rollup(), 'KLOW 80mg').kits).toBe(2);
  });

  // A product sold per piece is not suddenly ten to a box because it was
  // hatian'd — the divisor is the product's, whatever it is.
  it('uses a per-piece product kit size of 1 unchanged', async () => {
    await seedKahatiLine(7, { kitSize: 1, name: 'Profhilo' });

    expect(rowFor(await rollup(), 'Profhilo').kits).toBe(7);
  });

  // Counters written before product-level configuration name no product. The
  // hatian's own vial cap IS one kit by the feature's definition, so it is the
  // honest divisor — and it is NOT NULL, so this fallback always has a value.
  it('falls back to the hatian vial cap when the counter names no product', async () => {
    await seedKahatiLine(25, { kitSize: null, totalSlots: 10 });

    expect(rowFor(await rollup(), 'KLOW 80mg').kits).toBeCloseTo(2.5, 5);
  });

  it('honours a non-standard vial cap in that fallback', async () => {
    await seedKahatiLine(10, { kitSize: null, totalSlots: 5 });

    expect(rowFor(await rollup(), 'KLOW 80mg').kits).toBe(2);
  });
});

describe('the other line kinds keep their own units', () => {
  // A group buy campaign is committed in KITS already — moq and committed are
  // both kit counts — so dividing a campaign line would under-order it. This is
  // the guard that the kahati fix does not leak onto the campaign board.
  it('still reads a campaign line one kit per unit', async () => {
    const db = await getDb();
    const order = await makeOrder();
    const id = crypto.randomUUID();
    await db.insert(moqCampaigns).values({
      id, seriesId: id, batchNo: 1, name: 'Reta 20mg batch',
      pricePerKitPhp: '10400', moq: 10, committed: 0, status: 'open',
    });
    await db.insert(orderItems).values({
      orderId: order.id, kind: 'moq_campaign', moqCampaignId: id,
      nameSnapshot: 'Reta 20mg batch — group buy', specSnapshot: 'per kit',
      unitPricePhp: '10400', unitPriceUsd: '180', qty: 3, lineTotalPhp: '31200',
    });

    const row = rowFor(await rollup(), 'Reta 20mg batch');

    expect(row.qty).toBe(3);
    expect(row.kits).toBe(3);
  });
});
