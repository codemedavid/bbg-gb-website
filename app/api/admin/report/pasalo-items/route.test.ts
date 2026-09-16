import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb, makeGroupBuy, makeUser } from '@/lib/test/harness';
import { getDb, groupBuys, orders, orderItems } from '@/lib/db';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('@/lib/session', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  return { ApiError, requireAdmin: async () => {
    if (auth.role !== 'admin') throw new ApiError(403, 'Admin access required.');
    return { sub: 'admin' };
  } };
});
const { GET } = await import('./route');
const current = '2026-09-12T14:00:00.000Z';
const previous = '2026-09-05T14:00:00.000Z';
const request = (query = `cycleKey=${current}`) => GET(new Request(`http://localhost/api/admin/report/pasalo-items?${query}`));
beforeEach(async () => { await resetDb(); auth.role = 'admin'; });

async function counter(name: string, qty: number, cycleKey: string | null = current, status: 'open' | 'pasalo' | 'closed' | 'cancelled' = 'open') {
  const db = await getDb();
  const row = await makeGroupBuy({ name, totalSlots: 10, claimedSlots: qty, status });
  await db.update(groupBuys).set({ cycleKey }).where(eq(groupBuys.id, row.id));
  return row;
}

describe('Pasalo / Bunuan item report', () => {
  it('shows short and qualified incomplete kits before Pasalo is opened, excluding old, full, and empty counters', async () => {
    await counter('Needs rescue', 5);
    await counter('Top up kit', 8);
    await counter('Previous week', 4, previous, 'pasalo');
    await counter('Full', 10);
    await counter('Empty', 0);
    const res = await request();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toMatchObject({ name: 'Needs rescue', category: 'Pasalo', combinedVials: 5, neededToQualify: 2, slotsRemaining: 5 });
    expect(data.items[1]).toMatchObject({ name: 'Top up kit', category: 'Bunuan', combinedVials: 8, neededToQualify: 0, slotsRemaining: 2 });
  });

  it('keeps sibling kits separate and retains closed/cancelled state for review', async () => {
    await counter('Same product', 5, current, 'cancelled');
    await counter('Same product', 5, current, 'closed');
    const { data } = await (await request()).json();
    expect(data.items).toHaveLength(2);
    expect(data.items.map((i: { status: string }) => i.status).sort()).toEqual(['cancelled', 'closed']);
    expect(data.items.every((i: { neededToQualify: number }) => i.neededToQualify === 2)).toBe(true);
  });

  it('finds unstamped legacy counters through their orders without including unrelated legacy rows', async () => {
    const db = await getDb();
    const user = await makeUser();
    const legacy = await counter('Legacy current', 3, null);
    await counter('Legacy unrelated', 5, null);
    const [order] = await db.insert(orders).values({
      orderNo: 'KH-TEST', userId: user.id, cycleKey: current, buyType: 'kahati',
      subtotalPhp: '300', packingFeePhp: '150', totalPhp: '450',
      shipName: 'Test', shipPhone: '0917', shipAddress: 'Manila',
    }).returning();
    await db.insert(orderItems).values({ orderId: order.id, kind: 'group_buy', groupBuyId: legacy.id,
      nameSnapshot: 'Legacy current', qty: 3, unitPricePhp: '100', lineTotalPhp: '300' });
    const { data } = await (await request()).json();
    expect(data.items.map((i: { name: string }) => i.name)).toEqual(['Legacy current']);
  });

  it('rejects unscoped or ambiguous requests instead of mixing batches', async () => {
    expect((await request('')).status).toBe(400);
    expect((await request(`cycleKey=${current}&batchId=00000000-0000-4000-8000-000000000001`)).status).toBe(400);
  });

  it('requires admin access', async () => {
    auth.role = 'customer';
    expect((await request()).status).toBe(403);
  });
});
