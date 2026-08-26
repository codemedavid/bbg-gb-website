import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'admin'; email: string } | null };

vi.mock('@/lib/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/session')>('@/lib/session');
  return {
    ...actual,
    requireAdmin: async () => {
      if (!session.current) throw new Error('Admin session required.');
      return session.current;
    },
  };
});

const { GET } = await import('./route');
const { getDb, orders, orderItems, settlements } = await import('@/lib/db');
const { makeProduct, makeUser, resetDb } = await import('@/lib/test/harness');

const DAY = 86_400_000;

/** An instant on a given Manila calendar date, which is how the filter reads dates. */
const manila = (ymd: string, time = '12:00:00') => new Date(`${ymd}T${time}+08:00`);
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const stats = (query = '') => GET(new Request(`http://localhost/api/admin/stats${query}`));

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
});

async function addSettlement(
  userId: string,
  fee: number,
  createdAt: Date,
  status: 'proof_review' | 'paid' | 'cancelled' = 'paid',
) {
  const db = await getDb();
  const [row] = await db.insert(settlements).values({
    userId,
    status,
    packingFeePhp: String(fee),
    balancePhp: '0',
    totalPhp: String(fee),
    createdAt,
  }).returning();
  return row;
}

async function addOrder(
  userId: string,
  orderNo: string,
  fee: number,
  createdAt: Date,
  status: 'proof_review' | 'payment_confirmed' | 'cancelled' = 'payment_confirmed',
  settlementId: string | null = null,
) {
  const db = await getDb();
  const [row] = await db.insert(orders).values({
    userId,
    orderNo,
    status,
    buyType: 'solo',
    subtotalPhp: '1000',
    packingFeePhp: String(fee),
    totalPhp: String(1000 + fee),
    shipName: 'Analytics Customer',
    shipPhone: '09170000000',
    shipAddress: 'Test address',
    settlementId,
    createdAt,
  }).returning();
  return row;
}

async function addItem(orderId: string, productId: string, name: string, qty: number) {
  const db = await getDb();
  await db.insert(orderItems).values({
    orderId,
    productId,
    nameSnapshot: name,
    unitPricePhp: '1000',
    qty,
    lineTotalPhp: String(1000 * qty),
  });
}

describe('GET /api/admin/stats packing-fee analytics', () => {
  it('returns zero totals when no packing fees have accumulated', async () => {
    const body = await (await stats()).json();

    expect(body.data.packingFees).toEqual({ week: 0, month: 0, all: 0 });
  });

  it('combines order and deferred-settlement fees by period without cancelled or duplicate charges', async () => {
    const customer = await makeUser();

    await addOrder(customer.id, 'BBG-A1', 200, daysAgo(1));
    const recentSettlement = await addSettlement(customer.id, 150, daysAgo(1), 'proof_review');
    await addOrder(customer.id, 'BBG-A2', 150, daysAgo(1), 'payment_confirmed', recentSettlement.id);

    await addOrder(customer.id, 'BBG-A3', 300, daysAgo(15));
    await addSettlement(customer.id, 175, daysAgo(15));
    await addOrder(customer.id, 'BBG-A4', 400, daysAgo(45));
    await addSettlement(customer.id, 200, daysAgo(45));

    await addOrder(customer.id, 'BBG-CANCELLED', 500, daysAgo(1), 'cancelled');
    await addSettlement(customer.id, 999, daysAgo(1), 'cancelled');

    const body = await (await stats()).json();

    expect(body.data.packingFees).toEqual({
      week: 350,
      month: 825,
      all: 1425,
    });
  });
});

// The dashboard's fixed week/month/all-time framing cannot answer "how did the
// batch that ran 10–12 August do?". A chosen range has to reach every figure on
// the page, not just a headline: totals, packing fees, the day-by-day chart and
// the fast movers.
describe('GET /api/admin/stats date-range filter', () => {
  const FROM = '2026-08-10';
  const TO = '2026-08-12';
  const range = `?from=${FROM}&to=${TO}`;

  it('reports no range when none is asked for, leaving the default periods alone', async () => {
    const body = await (await stats()).json();

    expect(body.data.range).toBeNull();
    expect(body.data.totals.range).toBeUndefined();
    expect(body.data.packingFees.range).toBeUndefined();
  });

  it('scopes order count and revenue to the chosen Manila calendar days, inclusive of both ends', async () => {
    const customer = await makeUser();
    await addOrder(customer.id, 'BBG-IN-1', 100, manila(FROM, '00:30:00'));
    await addOrder(customer.id, 'BBG-IN-2', 100, manila(TO, '23:30:00'));
    await addOrder(customer.id, 'BBG-BEFORE', 100, manila('2026-08-09', '23:30:00'));
    await addOrder(customer.id, 'BBG-AFTER', 100, manila('2026-08-13', '00:30:00'));
    await addOrder(customer.id, 'BBG-VOID', 100, manila('2026-08-11'), 'cancelled');

    const body = await (await stats(range)).json();

    expect(body.data.range).toEqual({ from: FROM, to: TO });
    expect(body.data.totals.range).toEqual({ count: 2, revenue: 2200 });
    // All-time stays all-time — the range narrows the period cards, it does not
    // rewrite the lifetime figure the dashboard shows beside them.
    expect(body.data.totals.all.count).toBe(4);
  });

  it('scopes packing fees to the range, still excluding cancelled and settled-twice charges', async () => {
    const customer = await makeUser();
    await addOrder(customer.id, 'BBG-F1', 200, manila(FROM));
    const settled = await addSettlement(customer.id, 150, manila('2026-08-11'), 'paid');
    await addOrder(customer.id, 'BBG-F2', 150, manila('2026-08-11'), 'payment_confirmed', settled.id);
    await addOrder(customer.id, 'BBG-F3', 999, manila('2026-08-20'));
    await addOrder(customer.id, 'BBG-F4', 500, manila(TO), 'cancelled');

    const body = await (await stats(range)).json();

    expect(body.data.packingFees.range).toBe(350);
  });

  it('turns the weekly chart into a day-by-day summary of the range', async () => {
    const customer = await makeUser();
    await addOrder(customer.id, 'BBG-D1', 0, manila(FROM, '09:00:00'));
    await addOrder(customer.id, 'BBG-D2', 0, manila(FROM, '20:00:00'));
    await addOrder(customer.id, 'BBG-D3', 0, manila(TO, '09:00:00'));
    await addOrder(customer.id, 'BBG-OUT', 0, manila('2026-08-20'));

    const body = await (await stats(range)).json();

    expect(body.data.dailySummary.map((d: { day: string; count: number }) => [d.day, d.count]))
      .toEqual([[FROM, 2], [TO, 1]]);
  });

  it('ranks fast movers on the range alone, without falling back to lifetime catalog leaders', async () => {
    const customer = await makeUser();
    const product = await makeProduct({ name: 'Retatrutide' });
    const inRange = await addOrder(customer.id, 'BBG-M1', 0, manila('2026-08-11'));
    await addItem(inRange.id, product.id, 'Retatrutide 10mg', 7);
    const outside = await addOrder(customer.id, 'BBG-M2', 0, manila('2026-08-20'));
    await addItem(outside.id, product.id, 'Retatrutide 10mg', 99);

    const body = await (await stats(range)).json();

    expect(body.data.fastMoving).toEqual([
      expect.objectContaining({ name: 'Retatrutide 10mg', unitsSold: 7 }),
    ]);
  });

  it('leaves fast movers empty when the range sold nothing, instead of showing another period', async () => {
    await makeProduct({ name: 'Retatrutide' });

    const body = await (await stats(range)).json();

    expect(body.data.fastMoving).toEqual([]);
  });

  it('rejects an end date before the start date', async () => {
    const res = await stats(`?from=${TO}&to=${FROM}`);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/on or after/i);
  });

  it('rejects a malformed date instead of silently reporting the wrong period', async () => {
    const res = await stats('?from=last-tuesday&to=2026-08-12');

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/YYYY-MM-DD/);
  });

  it('rejects half a range, which would otherwise read as an open-ended filter', async () => {
    const res = await stats(`?from=${FROM}`);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/both/i);
  });
});
