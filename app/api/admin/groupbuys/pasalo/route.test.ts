// Integration tests for the two admin controls that bound the Pasalo (Bunuan)
// stage, and for the refund records closing it produces.
//
// The properties that matter here are not "does it return 200". They are: only
// an admin may reach any of it; closing twice does not pay anybody twice; and
// downloading a report never marks money as sent.
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
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST: OPEN } = await import('./route');
const { POST: CLOSE } = await import('./close/route');
const { PATCH: MARK } = await import('../../refunds/[id]/route');
const { GET: REPORT } = await import('../../report/pasalo-refund/route');
const { GET: XLSX } = await import('../../report/pasalo-refund/xlsx/route');
const { GET: WEEKLY } = await import('../../report/weekly/route');
const { getDb, groupBuys, orders, orderItems, orderItemRefunds } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy } = await import('@/lib/test/harness');
const { eq } = await import('drizzle-orm');

beforeEach(resetDb);

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const openReq = (body: Record<string, unknown> = {}) =>
  new Request('http://localhost/api/admin/groupbuys/pasalo', {
    method: 'POST', body: JSON.stringify(body),
  });
const reportReq = (from: string, to: string) =>
  new Request(`http://localhost/api/admin/report/pasalo-refund?from=${from}&to=${to}`);
const xlsxReq = (from: string, to: string, batchLabel?: string) =>
  new Request(`http://localhost/api/admin/report/pasalo-refund/xlsx?from=${from}&to=${to}`
    + (batchLabel ? `&batchLabel=${encodeURIComponent(batchLabel)}` : ''));

const today = () => new Date().toISOString().slice(0, 10);

async function seedFailingCounterWithBuyer(userId: string) {
  const db = await getDb();
  const gb = await makeGroupBuy({
    totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo', name: 'Cagrilintide 5mg',
  });
  const [order] = await db.insert(orders).values({
    orderNo: 'KH-9001', userId, status: 'payment_confirmed', paymentStatus: 'confirmed',
    buyType: 'kahati', subtotalPhp: '1650', packingFeePhp: '150', totalPhp: '1800',
    downpaymentPhp: '150', shipName: 'Juan Dela Cruz', shipPhone: '09171234567',
    shipAddress: 'Manila', cycleKey: '2026-W36',
  }).returning();
  await db.insert(orderItems).values({
    orderId: order.id, kind: 'group_buy', groupBuyId: gb.id,
    nameSnapshot: 'Cagrilintide 5mg — kahati', specSnapshot: 'Kahati · min 1 vials',
    unitPricePhp: '550', qty: 3, lineTotalPhp: '1650',
  });
  return { gb, order };
}

describe('POST /api/admin/groupbuys/pasalo — authorisation', () => {
  it('refuses an anonymous caller', async () => {
    session.current = null;
    expect((await OPEN(openReq())).status).toBe(401);
  });
  it('refuses a signed-in customer', async () => {
    await signIn('customer');
    expect((await OPEN(openReq())).status).toBe(403);
  });
});

describe('POST /api/admin/groupbuys/pasalo', () => {
  it('opens the stage on a short counter and reports what it skipped', async () => {
    await signIn();
    await makeGroupBuy({ totalSlots: 10, claimedSlots: 3, name: 'Short' });
    await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, name: 'Empty' });
    await makeGroupBuy({ totalSlots: 10, claimedSlots: 10, name: 'Full' });

    const res = await OPEN(openReq({ closesAt: '2026-09-12T12:00:00.000Z' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ opened: 1, skippedEmpty: 1, skippedFull: 1 });
  });

  it('accepts an empty body — a stage with no deadline runs until it is closed', async () => {
    await signIn();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3 });
    const res = await OPEN(new Request('http://localhost/api/admin/groupbuys/pasalo', { method: 'POST' }));

    expect(res.status).toBe(200);
    const db = await getDb();
    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, gb.id));
    expect(row.status).toBe('pasalo');
    expect(row.pasaloClosesAt).toBeNull();
  });
});

describe('POST /api/admin/groupbuys/pasalo/close — authorisation', () => {
  it('refuses an anonymous caller', async () => {
    session.current = null;
    expect((await CLOSE()).status).toBe(401);
  });
  it('refuses a signed-in customer', async () => {
    await signIn('customer');
    expect((await CLOSE()).status).toBe(403);
  });
});

describe('POST /api/admin/groupbuys/pasalo/close', () => {
  it('decides the batch and writes the refunds', async () => {
    const admin = await signIn();
    await seedFailingCounterWithBuyer(admin.id);

    const res = await CLOSE();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      failed: 1, fulfilled: 0, refundsWritten: 1, customersOwed: 1,
    });
    // Deposit only: the goods were never collected, so only the ₱150 that was.
    expect(body.data.refundTotalPhp).toBe(150);
  });

  it('pays nobody twice when closed again', async () => {
    const admin = await signIn();
    await seedFailingCounterWithBuyer(admin.id);

    await CLOSE();
    const second = await CLOSE();
    const body = await second.json();

    expect(body.data.refundsWritten).toBe(0);
    const db = await getDb();
    expect(await db.select().from(orderItemRefunds)).toHaveLength(1);
  });
});

describe('GET /api/admin/report/pasalo-refund', () => {
  it('refuses a signed-in customer', async () => {
    await signIn('customer');
    expect((await REPORT(reportReq('2026-09-01', '2026-09-30'))).status).toBe(403);
  });

  it('returns the customer roll-up, the evidence and the batch together', async () => {
    const admin = await signIn();
    await seedFailingCounterWithBuyer(admin.id);
    await CLOSE();

    const res = await REPORT(reportReq(today(), today()));
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.customers).toHaveLength(1);
    expect(data.customers[0]).toMatchObject({ customerName: 'Juan Dela Cruz', totalRefundPhp: 150 });
    expect(data.refunds).toHaveLength(1);
    expect(data.totals).toMatchObject({ customersRequiringRefund: 1, refundValuePhp: 150 });
  });

  it('reports the live stage separately from a past close', async () => {
    await signIn();
    await makeGroupBuy({ totalSlots: 10, claimedSlots: 5, kahatiVials: 3, status: 'pasalo', name: 'Live' });

    const res = await REPORT(reportReq(today(), today()));
    const { data } = await res.json();

    expect(data.board).toHaveLength(1);
    // The two figures said separately, which is the whole point.
    expect(data.board[0]).toMatchObject({ neededToQualify: 2, slotsRemaining: 5, combinedVials: 5 });
  });
});

describe('GET /api/admin/report/pasalo-refund/xlsx', () => {
  it('refuses a signed-in customer', async () => {
    await signIn('customer');
    expect((await XLSX(xlsxReq('2026-09-01', '2026-09-30'))).status).toBe(403);
  });

  it('streams a real xlsx named for the batch', async () => {
    const admin = await signIn();
    await seedFailingCounterWithBuyer(admin.id);
    await CLOSE();

    const res = await XLSX(xlsxReq(today(), today(), 'Batch 7'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type'))
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('Content-Disposition')).toContain('BBG-Refund-Report-Batch-7-');
    // A customer list must not sit in a shared cache.
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('refuses rather than handing back an empty workbook', async () => {
    // An empty sheet reads as "nobody was owed anything", which is a conclusion
    // an admin might act on.
    await signIn();
    expect((await XLSX(xlsxReq('2020-01-01', '2020-01-02'))).status).toBe(404);
  });

  it('does not mark anything refunded, however many times it is downloaded', async () => {
    const admin = await signIn();
    await seedFailingCounterWithBuyer(admin.id);
    await CLOSE();

    await XLSX(xlsxReq(today(), today()));
    await XLSX(xlsxReq(today(), today()));

    const db = await getDb();
    const [refund] = await db.select().from(orderItemRefunds);
    expect(refund.status).toBe('pending');
    expect(refund.refundedAt).toBeNull();
  });
});

describe('PATCH /api/admin/refunds/[id]', () => {
  const markReq = (id: string, body: Record<string, unknown>) => ({
    req: new Request(`http://localhost/api/admin/refunds/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ id }) },
  });

  async function closedRefund() {
    const admin = await signIn();
    await seedFailingCounterWithBuyer(admin.id);
    await CLOSE();
    const db = await getDb();
    const [refund] = await db.select().from(orderItemRefunds);
    return refund;
  }

  it('refuses a signed-in customer', async () => {
    const refund = await closedRefund();
    await signIn('customer');
    const { req, ctx } = markReq(refund.id, { status: 'refunded', reference: 'GC123' });
    expect((await MARK(req, ctx)).status).toBe(403);
  });

  it('records the transfer with its reference and who sent it', async () => {
    const refund = await closedRefund();
    const { req, ctx } = markReq(refund.id, {
      status: 'refunded', reference: 'GC-9931', method: 'GCash', refundAccount: '0917•••4567',
    });

    const res = await MARK(req, ctx);
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('refunded');
    expect(data.reference).toBe('GC-9931');
    expect(data.refundedAt).not.toBeNull();
    expect(data.refundedBy).not.toBeNull();
  });

  it('refuses to settle one without a reference', async () => {
    // The only thing that distinguishes a transfer that happened from one
    // somebody believed had.
    const refund = await closedRefund();
    const { req, ctx } = markReq(refund.id, { status: 'refunded' });
    const res = await MARK(req, ctx);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('reference');
  });

  it('refuses a second settlement of the same refund', async () => {
    // Two admins working the same sheet. The loser is told rather than
    // silently overwriting a transfer that already has a reference.
    const refund = await closedRefund();
    const first = markReq(refund.id, { status: 'refunded', reference: 'GC-1' });
    await MARK(first.req, first.ctx);
    const { req, ctx } = markReq(refund.id, { status: 'refunded', reference: 'GC-2' });

    expect((await MARK(req, ctx)).status).toBe(409);
  });

  it('keeps the original timestamp when a settled refund is annotated later', async () => {
    const refund = await closedRefund();
    const first = markReq(refund.id, { status: 'refunded', reference: 'GC-1' });
    const settled = await (await MARK(first.req, first.ctx)).json();

    const second = markReq(refund.id, { status: 'processing', notes: 'bank queried it' });
    const after = await (await MARK(second.req, second.ctx)).json();

    expect(after.data.refundedAt).toBe(settled.data.refundedAt);
  });

  it('404s on a refund that does not exist', async () => {
    await signIn();
    const { req, ctx } = markReq('11111111-1111-4111-8111-111111111111', { status: 'processing' });
    expect((await MARK(req, ctx)).status).toBe(404);
  });
});

describe('the batch order after a close', () => {
  it('drops a refunded line from the supplier batch sheet and the packing list', async () => {
    // The half of item-level refunding that is easy to forget. A mixed result
    // leaves the order LIVE — it still ships the surviving product — so the
    // failed line stays in order_items for the customer's records. If the
    // weekly report still counted it we would order vials from the supplier
    // for a product that did not reach its minimum and whose buyers have
    // already been paid back.
    const db = await getDb();
    const admin = await signIn();
    const good = await makeGroupBuy({
      name: 'Good', totalSlots: 10, claimedSlots: 9, kahatiVials: 9, status: 'pasalo',
    });
    const bad = await makeGroupBuy({
      name: 'Bad', totalSlots: 10, claimedSlots: 4, kahatiVials: 4, status: 'pasalo',
    });
    const [order] = await db.insert(orders).values({
      orderNo: 'KH-9100', userId: admin.id, status: 'payment_confirmed',
      paymentStatus: 'confirmed', buyType: 'kahati', subtotalPhp: '1650',
      packingFeePhp: '150', totalPhp: '1800', downpaymentPhp: '150',
      shipName: 'Juan Dela Cruz', shipPhone: '09171234567', shipAddress: 'Manila',
      cycleKey: '2026-W36',
    }).returning();
    await db.insert(orderItems).values([
      {
        orderId: order.id, kind: 'group_buy', groupBuyId: good.id,
        nameSnapshot: 'Retatrutide 15mg — kahati', unitPricePhp: '550', qty: 2, lineTotalPhp: '1100',
      },
      {
        orderId: order.id, kind: 'group_buy', groupBuyId: bad.id,
        nameSnapshot: 'Cagrilintide 5mg — kahati', unitPricePhp: '550', qty: 1, lineTotalPhp: '550',
      },
    ]);

    await CLOSE();

    const res = await WEEKLY(new Request(
      `http://localhost/api/admin/report/weekly?from=${today()}&to=${today()}`,
    ));
    const { data } = await res.json();
    const names = data.report.productTotals.rows.map((r: { name: string }) => r.name);

    expect(names.join(' ')).toContain('Retatrutide');
    expect(names.join(' ')).not.toContain('Cagrilintide');
  });
});
