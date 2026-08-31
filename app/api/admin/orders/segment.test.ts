// The admin orders list, split by segment.
//
// One list mixing on-hand sales, hatian commitments and campaign pre-orders is
// three different jobs stacked in one table: on-hand asks "what leaves the
// shelf", kahati asks "who still owes a balance", group buy asks "what do we
// order from the supplier". The admin filtered by reading order prefixes.
//
// Filtered on the server rather than in the browser: the list is unpaginated
// and returns every order ever placed, so a client-side filter would still ship
// the whole table down the wire to throw three quarters of it away.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError,
    getSession: async () => session.current,
    requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin only.');
      return s;
    },
  };
});

const { GET } = await import('./route');
const { resetDb, makeUser } = await import('@/lib/test/harness');

type Seeded = { orderNo: string; buyType: 'solo' | 'kahati' | 'group_buy' | 'moq'; status?: 'proof_review' | 'payment_confirmed' };

const SEED: Seeded[] = [
  { orderNo: 'BBG-9001', buyType: 'solo' },
  { orderNo: 'KH-9002', buyType: 'kahati' },
  { orderNo: 'GB-9003', buyType: 'group_buy' },
  { orderNo: 'MQ-9004', buyType: 'moq', status: 'payment_confirmed' },
];

async function seedOrders() {
  const user = await makeUser({ role: 'customer' });
  const { getDb, orders } = await import('@/lib/db');
  const db = await getDb();
  await db.insert(orders).values(SEED.map((o) => ({
    orderNo: o.orderNo, userId: user.id, buyType: o.buyType, status: o.status ?? 'proof_review',
    subtotalPhp: '1000.00', totalPhp: '1000.00',
    shipName: 'Ana Cruz', shipPhone: '09171234567', shipAddress: '123 Mabini St, Manila',
  })));
}

/** Read the admin list back, returning the order numbers it contains. */
async function listOrderNos(query = ''): Promise<string[]> {
  const res = await GET(new Request(`http://localhost/api/admin/orders${query}`));
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return (body.data as { orderNo: string }[]).map((o) => o.orderNo);
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: admin.role, email: admin.email };
  await seedOrders();
});

describe('GET /api/admin/orders?segment=', () => {
  it('returns every order when no segment is asked for', async () => {
    expect((await listOrderNos()).sort()).toEqual(['BBG-9001', 'GB-9003', 'KH-9002', 'MQ-9004']);
  });

  it('returns only on-hand orders for segment=onhand', async () => {
    expect(await listOrderNos('?segment=onhand')).toEqual(['BBG-9001']);
  });

  it('returns only hatian orders for segment=kahati', async () => {
    expect(await listOrderNos('?segment=kahati')).toEqual(['KH-9002']);
  });

  // Campaign commitments and MOQ pre-orders are both ordered from the supplier,
  // so they share a page — the same split lib/report/segment.ts already makes.
  it('returns campaign and MOQ orders together for segment=groupbuy', async () => {
    expect((await listOrderNos('?segment=groupbuy')).sort()).toEqual(['GB-9003', 'MQ-9004']);
  });

  it('narrows by status within a segment', async () => {
    expect(await listOrderNos('?segment=groupbuy&status=payment_confirmed')).toEqual(['MQ-9004']);
  });

  // A typo in the URL must not silently return the unfiltered list — an admin
  // reading "on-hand" off the heading while looking at every order is worse
  // than an error.
  it('rejects an unknown segment', async () => {
    const res = await GET(new Request('http://localhost/api/admin/orders?segment=onhnd'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/segment/i);
  });
});
