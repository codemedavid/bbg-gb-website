import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'admin'; email: string } | null };

vi.mock('@/lib/session', () => ({
  requireAdmin: async () => {
    if (!session.current) throw new Error('Admin session required.');
    return session.current;
  },
}));

const { GET } = await import('./route');
const { getDb, orders, settlements } = await import('@/lib/db');
const { makeUser, resetDb } = await import('@/lib/test/harness');

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
});

async function addSettlement(
  userId: string,
  fee: number,
  ageDays: number,
  status: 'proof_review' | 'paid' | 'cancelled' = 'paid',
) {
  const db = await getDb();
  const [row] = await db.insert(settlements).values({
    userId,
    status,
    packingFeePhp: String(fee),
    balancePhp: '0',
    totalPhp: String(fee),
    createdAt: new Date(Date.now() - ageDays * DAY),
  }).returning();
  return row;
}

async function addOrder(
  userId: string,
  orderNo: string,
  fee: number,
  ageDays: number,
  status: 'proof_review' | 'payment_confirmed' | 'cancelled' = 'payment_confirmed',
  settlementId: string | null = null,
) {
  const db = await getDb();
  await db.insert(orders).values({
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
    createdAt: new Date(Date.now() - ageDays * DAY),
  });
}

describe('GET /api/admin/stats packing-fee analytics', () => {
  it('returns zero totals when no packing fees have accumulated', async () => {
    const body = await (await GET()).json();

    expect(body.data.packingFees).toEqual({ week: 0, month: 0, all: 0 });
  });

  it('combines order and deferred-settlement fees by period without cancelled or duplicate charges', async () => {
    const customer = await makeUser();

    await addOrder(customer.id, 'BBG-A1', 200, 1);
    const recentSettlement = await addSettlement(customer.id, 150, 1, 'proof_review');
    await addOrder(customer.id, 'BBG-A2', 150, 1, 'payment_confirmed', recentSettlement.id);

    await addOrder(customer.id, 'BBG-A3', 300, 15);
    await addSettlement(customer.id, 175, 15);
    await addOrder(customer.id, 'BBG-A4', 400, 45);
    await addSettlement(customer.id, 200, 45);

    await addOrder(customer.id, 'BBG-CANCELLED', 500, 1, 'cancelled');
    await addSettlement(customer.id, 999, 1, 'cancelled');

    const body = await (await GET()).json();

    expect(body.data.packingFees).toEqual({
      week: 350,
      month: 825,
      all: 1425,
    });
  });
});
