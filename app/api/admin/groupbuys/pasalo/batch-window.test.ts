// Scoping Pasalo to ONE batch.
//
// Both Pasalo controls used to sweep the whole board: opening moved every
// counter sitting at 'open', and closing decided every counter sitting at
// 'pasalo' — whatever cycle it came from. A counter left behind by an earlier
// batch was therefore cancelled and its customers refunded alongside the batch
// the admin was actually looking at, which is old data moving real money.
//
// So both take the Reports page's date range and judge each counter by when its
// Kahati STARTED (opens_at, or created_at for a counter that was never
// scheduled). Out-of-range counters are left exactly where they are and counted
// back in the response — silently skipping them would strand a batch in Pasalo
// forever, which is the opposite failure.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manilaYmd } from '@/lib/report/week';

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
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST: OPEN } = await import('./route');
const { POST: CLOSE } = await import('./close/route');
const { GET: REPORT } = await import('../../report/pasalo-refund/route');
const { getDb, groupBuys, orders, orderItems, orderItemRefunds } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy } = await import('@/lib/test/harness');
const { eq } = await import('drizzle-orm');

beforeEach(resetDb);

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const today = () => manilaYmd(new Date());
const DAY_MS = 24 * 60 * 60 * 1000;
/** Well before any range a test picks — an unmistakably older batch. */
const LAST_CYCLE = new Date(Date.now() - 60 * DAY_MS);

const openReq = (body: Record<string, unknown> = {}) =>
  new Request('http://localhost/api/admin/groupbuys/pasalo', {
    method: 'POST', body: JSON.stringify(body),
  });
const closeReq = (body: Record<string, unknown> = {}) =>
  new Request('http://localhost/api/admin/groupbuys/pasalo/close', {
    method: 'POST', body: JSON.stringify(body),
  });
const reportReq = (from: string, to: string) =>
  new Request(`http://localhost/api/admin/report/pasalo-refund?from=${from}&to=${to}`);

/** A short counter in Pasalo with one paying buyer on it. */
async function seedFailingCounter(
  userId: string,
  opts: { name: string; orderNo: string; createdAt?: Date; opensAt?: Date | null },
) {
  const db = await getDb();
  const gb = await makeGroupBuy({
    totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo', name: opts.name,
    createdAt: opts.createdAt, opensAt: opts.opensAt ?? null,
  });
  const [order] = await db.insert(orders).values({
    orderNo: opts.orderNo, userId, status: 'payment_confirmed', paymentStatus: 'confirmed',
    buyType: 'kahati', subtotalPhp: '1650', packingFeePhp: '150', totalPhp: '1800',
    downpaymentPhp: '150', shipName: 'Juan Dela Cruz', shipPhone: '09171234567',
    shipAddress: 'Manila', cycleKey: '2026-W36',
  }).returning();
  await db.insert(orderItems).values({
    orderId: order.id, kind: 'group_buy', groupBuyId: gb.id,
    nameSnapshot: `${opts.name} — kahati`, specSnapshot: 'Kahati · min 1 vials',
    unitPricePhp: '550', qty: 3, lineTotalPhp: '1650',
  });
  return { gb, order };
}

const statusOf = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row.status;
};

describe('POST /api/admin/groupbuys/pasalo — opening only this batch', () => {
  it('leaves a counter from an earlier cycle on the Kahati board', async () => {
    await signIn();
    const stale = await makeGroupBuy({
      totalSlots: 10, claimedSlots: 3, name: 'Last cycle', createdAt: LAST_CYCLE,
    });
    const current = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3, name: 'This cycle' });

    const res = await OPEN(openReq({ from: today(), to: today() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ opened: 1, skippedOutOfRange: 1 });
    expect(await statusOf(current.id)).toBe('pasalo');
    expect(await statusOf(stale.id)).toBe('open');
  });

  it('judges a scheduled counter by its opens_at, not by when it was created', async () => {
    await signIn();
    // Written weeks early for this cycle. Its created_at belongs to the old
    // batch; its schedule is what decides.
    const scheduled = await makeGroupBuy({
      totalSlots: 10, claimedSlots: 3, name: 'Scheduled ahead',
      createdAt: LAST_CYCLE, opensAt: new Date(),
    });

    const res = await OPEN(openReq({ from: today(), to: today() }));

    expect((await res.json()).data).toMatchObject({ opened: 1, skippedOutOfRange: 0 });
    expect(await statusOf(scheduled.id)).toBe('pasalo');
  });

  it('still sweeps the whole board when no range is given', async () => {
    await signIn();
    const stale = await makeGroupBuy({
      totalSlots: 10, claimedSlots: 3, name: 'Last cycle', createdAt: LAST_CYCLE,
    });

    const res = await OPEN(openReq());

    expect((await res.json()).data).toMatchObject({ opened: 1, skippedOutOfRange: 0 });
    expect(await statusOf(stale.id)).toBe('pasalo');
  });
});

describe('POST /api/admin/groupbuys/pasalo/close — deciding only this batch', () => {
  it('does not refund a counter left over from an earlier cycle', async () => {
    const admin = await signIn();
    const stale = await seedFailingCounter(admin.id, {
      name: 'Last cycle', orderNo: 'KH-8001', createdAt: LAST_CYCLE,
    });
    const current = await seedFailingCounter(admin.id, {
      name: 'This cycle', orderNo: 'KH-9001',
    });

    const res = await CLOSE(closeReq({ from: today(), to: today() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ failed: 1, refundsWritten: 1, skippedOutOfRange: 1 });

    // The older batch is untouched — still in the stage, no money decided.
    expect(await statusOf(stale.gb.id)).toBe('pasalo');
    expect(await statusOf(current.gb.id)).toBe('cancelled');

    const db = await getDb();
    const written = await db.select().from(orderItemRefunds);
    expect(written).toHaveLength(1);
    expect(written[0].orderId).toBe(current.order.id);
  });

  it('reports nothing skipped when the whole stage belongs to this batch', async () => {
    const admin = await signIn();
    await seedFailingCounter(admin.id, { name: 'This cycle', orderNo: 'KH-9001' });

    const body = await (await CLOSE(closeReq({ from: today(), to: today() }))).json();

    expect(body.data).toMatchObject({ failed: 1, refundsWritten: 1, skippedOutOfRange: 0 });
  });

  it('still decides the whole stage when no range is given', async () => {
    const admin = await signIn();
    const stale = await seedFailingCounter(admin.id, {
      name: 'Last cycle', orderNo: 'KH-8001', createdAt: LAST_CYCLE,
    });

    const body = await (await CLOSE(closeReq())).json();

    expect(body.data).toMatchObject({ failed: 1, refundsWritten: 1, skippedOutOfRange: 0 });
    expect(await statusOf(stale.gb.id)).toBe('cancelled');
  });
});

describe('GET /api/admin/report/pasalo-refund — naming what this batch excludes', () => {
  it('marks a Pasalo counter from an earlier cycle as outside the range', async () => {
    const admin = await signIn();
    await seedFailingCounter(admin.id, {
      name: 'Last cycle', orderNo: 'KH-8001', createdAt: LAST_CYCLE,
    });
    await seedFailingCounter(admin.id, { name: 'This cycle', orderNo: 'KH-9001' });

    const body = await (await REPORT(reportReq(today(), today()))).json();
    const board = body.data.board as { productName: string; inWindow: boolean }[];

    expect(board.find((c) => c.productName === 'This cycle')?.inWindow).toBe(true);
    expect(board.find((c) => c.productName === 'Last cycle')?.inWindow).toBe(false);
  });
});
