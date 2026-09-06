// END-TO-END: refund determination, the workbook, and authorisation.
//
// Every money assertion is checked against the DATABASE, not against what a
// route returned, and the workbook is checked against the same figures — the
// requirement is that the screen, the database and the file agree.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Workbook } from 'exceljs';
import type { TestSession } from '@/lib/test/pasalo-e2e';
import { manilaYmd } from '@/lib/report/week';

const session = { current: null as TestSession };
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

const { POST: CHECKOUT } = await import('@/app/api/orders/route');
const { POST: OPEN_PASALO } = await import('@/app/api/admin/groupbuys/pasalo/route');
const { POST: CLOSE_PASALO } = await import('@/app/api/admin/groupbuys/pasalo/close/route');
const { GET: REFUND_JSON } = await import('@/app/api/admin/report/pasalo-refund/route');
const { GET: REFUND_XLSX } = await import('@/app/api/admin/report/pasalo-refund/xlsx/route');
const { PATCH: MARK_REFUND } = await import('@/app/api/admin/refunds/[id]/route');
const { PATCH: SET_ORDER_STATUS } = await import('@/app/api/admin/orders/[id]/status/route');
const { resetDb } = await import('@/lib/test/harness');
const {
  makeCustomer, makeKahatiProduct, checkoutForm, checkoutRequest, openStorefront,
  counterRow, orderRow, itemsOfOrder, allRefunds, settleOrder,
} = await import('@/lib/test/pasalo-e2e');

beforeEach(async () => {
  await resetDb();
  await openStorefront();
  session.current = null;
});

type Customer = { id: string; email: string; role: 'customer' | 'admin' };
const asUser = (u: Customer) => { session.current = { sub: u.id, role: u.role, email: u.email }; };

async function asAdmin() {
  const admin = await makeCustomer('e2e-admin');
  const { getDb, users } = await import('@/lib/db');
  const { eq } = await import('drizzle-orm');
  const db = await getDb();
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
  return admin;
}

async function joinMany(user: Customer, lines: { counterId: string; qty: number }[]) {
  asUser(user);
  const res = await CHECKOUT(checkoutRequest(checkoutForm(
    lines.map((l) => ({ kind: 'group_buy', refId: l.counterId, qty: l.qty })),
  )));
  const body = await res.json();
  return { status: res.status, orderId: body?.data?.order?.id as string | undefined };
}

const join = (user: Customer, counterId: string, qty: number) =>
  joinMany(user, [{ counterId, qty }]);

async function confirmPayment(orderId: string) {
  const prior = session.current;
  await asAdmin();
  await SET_ORDER_STATUS(
    new Request(`http://localhost/api/admin/orders/${orderId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'payment_confirmed' }),
    }),
    { params: Promise.resolve({ id: orderId }) },
  );
  session.current = prior;
}

async function fillCounter(counterId: string, vials: number) {
  for (let i = 0; i < vials; i++) {
    const buyer = await makeCustomer(`e2e-bulk-${i}`);
    const { status, orderId } = await join(buyer, counterId, 1);
    expect(status).toBe(201);
    await confirmPayment(orderId!);
  }
}

const openPasalo = async () => {
  await asAdmin();
  return OPEN_PASALO(new Request('http://localhost/api/admin/groupbuys/pasalo', {
    method: 'POST', body: JSON.stringify({}),
  }));
};
const closePasalo = async () => { await asAdmin(); return CLOSE_PASALO(); };

const today = () => manilaYmd(new Date());

async function refundReport() {
  await asAdmin();
  const res = await REFUND_JSON(new Request(
    `http://localhost/api/admin/report/pasalo-refund?from=${today()}&to=${today()}`,
  ));
  return (await res.json()).data;
}

async function refundWorkbook(): Promise<Workbook> {
  await asAdmin();
  const res = await REFUND_XLSX(new Request(
    `http://localhost/api/admin/report/pasalo-refund/xlsx?from=${today()}&to=${today()}&batchLabel=${encodeURIComponent('E2E-TEST-BBG')}`,
  ));
  expect(res.status).toBe(200);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return wb;
}

// Data rows only. Every sheet closes with a bold TOTAL row whose cells are
// mostly null, and folding that into a column read turns "null" into a value
// the assertions then try to look up.
const cellsOf = (wb: Workbook, sheet: string, col: number): unknown[] => {
  const ws = wb.getWorksheet(sheet)!;
  const out: unknown[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    if (String(row.getCell(1).value ?? '').startsWith('TOTAL')) return;
    const value = row.getCell(col).value;
    if (value != null) out.push(value);
  });
  return out;
};

// ---------------------------------------------------------------------------

describe('SCENARIO 7 — one customer, mixed outcome', () => {
  it('refunds only the failed product and leaves the successful ones shipping', async () => {
    const a = await makeKahatiProduct('S7-A', { pricePerKitPhp: 5000 }); // ₱500/vial
    const b = await makeKahatiProduct('S7-B', { pricePerKitPhp: 6000 }); // ₱600/vial
    const c = await makeKahatiProduct('S7-C', { pricePerKitPhp: 7000 }); // ₱700/vial
    await fillCounter(a.counterId, 8);
    await fillCounter(c.counterId, 9);
    await fillCounter(b.counterId, 4);

    const customer = await makeCustomer('e2e-mixed');
    const { status, orderId } = await joinMany(customer, [
      { counterId: a.counterId, qty: 1 },
      { counterId: b.counterId, qty: 1 },
      { counterId: c.counterId, qty: 1 },
    ]);
    expect(status).toBe(201);
    await confirmPayment(orderId!);
    // The goods were actually collected, which is what makes them refundable.
    await settleOrder(orderId!);

    await openPasalo();
    await closePasalo();

    expect((await counterRow(a.counterId)).status).toBe('closed');
    expect((await counterRow(c.counterId)).status).toBe('closed');
    expect((await counterRow(b.counterId)).status).toBe('cancelled');

    // The order survives and still ships A and C.
    const after = await orderRow(orderId!);
    expect(after.status).not.toBe('cancelled');

    const mine = (await allRefunds()).filter((r) => r.userId === customer.id);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0].amountPhp)).toBe(600);

    const report = await refundReport();
    const row = report.customers.find((r: { userId: string }) => r.userId === customer.id);
    expect(row.totalRefundPhp).toBe(600);
    expect(row.successfulPhp).toBe(1200);
    // Never ₱1,800.
    expect(row.totalRefundPhp).not.toBe(1800);
  });
});

describe('SCENARIO 8 — two failed items, one successful', () => {
  it('refunds ₱1,100 and keeps ₱700 shipping', async () => {
    const a = await makeKahatiProduct('S8-A', { pricePerKitPhp: 5000 });
    const b = await makeKahatiProduct('S8-B', { pricePerKitPhp: 6000 });
    const c = await makeKahatiProduct('S8-C', { pricePerKitPhp: 7000 });
    await fillCounter(a.counterId, 3);
    await fillCounter(b.counterId, 2);
    await fillCounter(c.counterId, 8);

    const customer = await makeCustomer('e2e-two-failed');
    const { orderId } = await joinMany(customer, [
      { counterId: a.counterId, qty: 1 },
      { counterId: b.counterId, qty: 1 },
      { counterId: c.counterId, qty: 1 },
    ]);
    await confirmPayment(orderId!);
    await settleOrder(orderId!);

    await openPasalo();
    await closePasalo();

    const mine = (await allRefunds()).filter((r) => r.userId === customer.id);
    expect(mine).toHaveLength(2);
    expect(mine.reduce((s, r) => s + Number(r.goodsPhp), 0)).toBe(1100);

    const report = await refundReport();
    const row = report.customers.find((r: { userId: string }) => r.userId === customer.id);
    expect(row.goodsRefundPhp).toBe(1100);
    expect(row.successfulPhp).toBe(700);
  });
});

describe('SCENARIO 9 — one customer, two orders, same failing product', () => {
  it('consolidates to a single summary row totalling ₱600', async () => {
    const a = await makeKahatiProduct('S9-A', { pricePerKitPhp: 5000 });
    const b = await makeKahatiProduct('S9-B', { pricePerKitPhp: 3000 }); // ₱300/vial
    const c = await makeKahatiProduct('S9-C', { pricePerKitPhp: 6000 });
    await fillCounter(a.counterId, 8);
    await fillCounter(c.counterId, 8);
    await fillCounter(b.counterId, 3);

    const customer = await makeCustomer('e2e-two-orders');
    const first = await joinMany(customer, [
      { counterId: a.counterId, qty: 1 }, { counterId: b.counterId, qty: 1 },
    ]);
    const second = await joinMany(customer, [
      { counterId: c.counterId, qty: 1 }, { counterId: b.counterId, qty: 1 },
    ]);
    await confirmPayment(first.orderId!);
    await confirmPayment(second.orderId!);
    await settleOrder(first.orderId!);
    await settleOrder(second.orderId!);

    await openPasalo();
    await closePasalo();

    const report = await refundReport();
    const rows = report.customers.filter((r: { userId: string }) => r.userId === customer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].failedItems).toBe(2);
    expect(rows[0].goodsRefundPhp).toBe(600);
    expect(rows[0].successfulPhp).toBe(1100);
    expect(rows[0].relevantPaidPhp).toBe(1700);
    expect(rows[0].orderNos.split(', ')).toHaveLength(2);
  });
});

describe('BUG HUNT — an order spanning the stage and the live board', () => {
  it('must not cancel an order because its other line is on a counter outside this close', async () => {
    // A customer joins a hatian that later falls short AND a hatian that is
    // still on the Kahati board (never entered this Pasalo). Closing the stage
    // sees only the staged counters, so the live line is invisible to it — and
    // an order whose only VISIBLE line failed looks like an order where
    // everything failed.
    const failing = await makeKahatiProduct('BUG-failing', { pricePerKitPhp: 5000 });
    const live = await makeKahatiProduct('BUG-live', { pricePerKitPhp: 6000 });
    await fillCounter(failing.counterId, 3);

    const customer = await makeCustomer('e2e-spanning');
    const { orderId } = await joinMany(customer, [
      { counterId: failing.counterId, qty: 1 },
      { counterId: live.counterId, qty: 2 },
    ]);
    await confirmPayment(orderId!);

    // Only the failing counter is staged; `live` opened AFTER, so it is not.
    const { getDb, groupBuys } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    await db.update(groupBuys).set({ status: 'open' }).where(eq(groupBuys.id, live.counterId));
    await openPasalo();
    await db.update(groupBuys).set({ status: 'open', kahatiVials: null })
      .where(eq(groupBuys.id, live.counterId));

    await closePasalo();

    const after = await orderRow(orderId!);
    // The customer still has 2 vials coming on a live counter.
    expect(after.status).not.toBe('cancelled');

    // ...and is still billed for them.
    const items = await itemsOfOrder(orderId!);
    const survivingValue = items
      .filter((i) => i.groupBuyId === live.counterId)
      .reduce((s, i) => s + Number(i.lineTotalPhp), 0);
    expect(survivingValue).toBe(1200);
    expect(Number(after.subtotalPhp)).toBe(survivingValue);
  });
});

describe('SCENARIO 22 — price changed after purchase', () => {
  it('refunds the captured line price, never the repriced one', async () => {
    const p = await makeKahatiProduct('S22', { pricePerKitPhp: 5000 }); // ₱500/vial
    await fillCounter(p.counterId, 3);

    const customer = await makeCustomer('e2e-reprice');
    const { orderId } = await join(customer, p.counterId, 1);
    await confirmPayment(orderId!);
    await settleOrder(orderId!);

    // Admin reprices the counter and the catalog product afterwards.
    const { getDb, groupBuys, products } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    await db.update(groupBuys).set({ pricePerKitPhp: '6500' }).where(eq(groupBuys.id, p.counterId));
    await db.update(products).set({ pricePhp: '6500' }).where(eq(products.id, p.productId));

    await openPasalo();
    await closePasalo();

    const mine = (await allRefunds()).filter((r) => r.userId === customer.id);
    expect(Number(mine[0].goodsPhp)).toBe(500);
    expect(Number(mine[0].unitPricePhp)).toBe(500);
    expect(Number(mine[0].goodsPhp)).not.toBe(650);
  });
});

describe('SCENARIO 24 — fees', () => {
  it('keeps the packing deposit when the customer still has a parcel coming', async () => {
    const ok = await makeKahatiProduct('S24-ok');
    const bad = await makeKahatiProduct('S24-bad');
    await fillCounter(ok.counterId, 8);
    await fillCounter(bad.counterId, 3);

    const customer = await makeCustomer('e2e-fee-mixed');
    const { orderId } = await joinMany(customer, [
      { counterId: ok.counterId, qty: 1 }, { counterId: bad.counterId, qty: 1 },
    ]);
    await confirmPayment(orderId!);

    await openPasalo();
    await closePasalo();

    const mine = (await allRefunds()).filter((r) => r.userId === customer.id);
    expect(mine.reduce((s, r) => s + Number(r.depositPhp), 0)).toBe(0);
  });

  it('returns the deposit only when nothing the customer ordered survived', async () => {
    const bad = await makeKahatiProduct('S24-all-bad');
    await fillCounter(bad.counterId, 3);

    const customer = await makeCustomer('e2e-fee-all-bad');
    const { orderId } = await join(customer, bad.counterId, 1);
    await confirmPayment(orderId!);
    const order = await orderRow(orderId!);
    const deposit = Number(order.downpaymentPhp);
    expect(deposit).toBeGreaterThan(0);

    await openPasalo();
    await closePasalo();

    const mine = (await allRefunds()).filter((r) => r.userId === customer.id);
    expect(mine.reduce((s, r) => s + Number(r.depositPhp), 0)).toBe(deposit);
  });

  it('refunds nothing on goods that were never collected', async () => {
    // The load-bearing fee rule: a hatian settles goods AFTER the batch is
    // confirmed, so an unsettled failed line has had no money taken for it.
    const bad = await makeKahatiProduct('S24-unsettled', { pricePerKitPhp: 5000 });
    await fillCounter(bad.counterId, 3);

    const customer = await makeCustomer('e2e-unsettled');
    const { orderId } = await join(customer, bad.counterId, 1);
    await confirmPayment(orderId!);

    await openPasalo();
    await closePasalo();

    const mine = (await allRefunds()).filter((r) => r.userId === customer.id);
    expect(Number(mine[0].goodsPhp)).toBe(0);
    expect(mine[0].collectedBasis).toBe('deposit_only');
  });
});

describe('SCENARIO 17/18 — refund status lifecycle', () => {
  async function oneFailedRefund() {
    const bad = await makeKahatiProduct('S17', { pricePerKitPhp: 5000 });
    await fillCounter(bad.counterId, 3);
    const customer = await makeCustomer('e2e-status');
    const { orderId } = await join(customer, bad.counterId, 1);
    await confirmPayment(orderId!);
    await settleOrder(orderId!);
    await openPasalo();
    await closePasalo();
    const [refund] = (await allRefunds()).filter((r) => r.userId === customer.id);
    return { refund, customer };
  }

  const markReq = (id: string, body: Record<string, unknown>) => ({
    req: new Request(`http://localhost/api/admin/refunds/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ id }) },
  });

  it('starts PENDING and exporting twice never changes that', async () => {
    const { refund } = await oneFailedRefund();
    expect(refund.status).toBe('pending');

    await refundWorkbook();
    await refundWorkbook();

    const [after] = (await allRefunds()).filter((r) => r.id === refund.id);
    expect(after.status).toBe('pending');
    expect(after.refundedAt).toBeNull();
    // And no export minted a duplicate row for anybody.
    const all = await allRefunds();
    expect(new Set(all.map((r) => r.orderItemId)).size).toBe(all.length);
  });

  it('records the full audit trail when marked complete', async () => {
    const { refund } = await oneFailedRefund();
    await asAdmin();
    const { req, ctx } = markReq(refund.id, {
      status: 'refunded', reference: 'GC-E2E-001', method: 'GCash',
      refundAccount: '0917•••4567', notes: 'sent via GCash',
    });

    const res = await MARK_REFUND(req, ctx);
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('refunded');
    expect(data.reference).toBe('GC-E2E-001');
    expect(data.method).toBe('GCash');
    expect(data.refundAccount).toBe('0917•••4567');
    expect(data.notes).toBe('sent via GCash');
    expect(data.refundedAt).not.toBeNull();
    expect(data.refundedBy).not.toBeNull();
    expect(Number(data.amountPhp)).toBeGreaterThan(0);
  });

  it('refuses a duplicate settlement and names the original reference', async () => {
    const { refund } = await oneFailedRefund();
    await asAdmin();
    const first = markReq(refund.id, { status: 'refunded', reference: 'GC-E2E-001' });
    await MARK_REFUND(first.req, first.ctx);

    const second = markReq(refund.id, { status: 'refunded', reference: 'GC-E2E-002' });
    const res = await MARK_REFUND(second.req, second.ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('GC-E2E-001');
    const [after] = (await allRefunds()).filter((r) => r.id === refund.id);
    expect(after.reference).toBe('GC-E2E-001');
  });

  it('shows the completed status on a re-export', async () => {
    const { refund } = await oneFailedRefund();
    await asAdmin();
    const { req, ctx } = markReq(refund.id, { status: 'refunded', reference: 'GC-E2E-003' });
    await MARK_REFUND(req, ctx);

    const wb = await refundWorkbook();
    expect(cellsOf(wb, 'Refund Summary', 14)).toContain('Refunded');
    expect(cellsOf(wb, 'Refund Summary', 16)).toContain('GC-E2E-003');
  });
});

describe('SCENARIO 19/20/21 — the workbook', () => {
  async function batchWithRefunds() {
    const ok = await makeKahatiProduct('S19-ok', { pricePerKitPhp: 7000 });
    const bad = await makeKahatiProduct('S19-bad', { pricePerKitPhp: 5000 });
    await fillCounter(ok.counterId, 8);
    await fillCounter(bad.counterId, 3);

    const customer = await makeCustomer('e2e-xlsx');
    const { orderId } = await joinMany(customer, [
      { counterId: ok.counterId, qty: 1 }, { counterId: bad.counterId, qty: 2 },
    ]);
    await confirmPayment(orderId!);
    await settleOrder(orderId!);

    await openPasalo();
    await closePasalo();
    return { customer, orderId: orderId!, ok, bad };
  }

  it('opens with the four expected sheets', async () => {
    await batchWithRefunds();
    const wb = await refundWorkbook();
    expect(wb.worksheets.map((s) => s.name))
      .toEqual(['Refund Summary', 'Items to Refund', 'Successful Items', 'Batch Summary']);
  });

  it('matches the database on every customer total', async () => {
    const { customer } = await batchWithRefunds();
    const wb = await refundWorkbook();
    const report = await refundReport();

    const ws = wb.getWorksheet('Refund Summary')!;
    let row = ws.getRow(2);
    ws.eachRow((r, n) => { if (n > 1 && r.getCell(2).value === customer.id) row = r; });
    const expected = report.customers.find((c: { userId: string }) => c.userId === customer.id);

    expect(row.getCell(2).value).toBe(customer.id);
    expect(row.getCell(13).value).toBe(expected.totalRefundPhp);
    expect(row.getCell(10).value).toBe(expected.successfulPhp);

    // Independent recomputation straight from the refund rows.
    const dbTotal = (await allRefunds())
      .filter((r) => r.userId === customer.id)
      .reduce((s, r) => s + Number(r.amountPhp), 0);
    expect(row.getCell(13).value).toBe(dbTotal);
  });

  it('carries traceable ids that resolve to real records', async () => {
    const { orderId } = await batchWithRefunds();
    const wb = await refundWorkbook();
    // Every id on the sheet must resolve to a real order_items row — no orphan
    // rows, and no value invented by a rendering layer.
    const itemIds = cellsOf(wb, 'Items to Refund', 6).map(String);
    const { getDb, orderItems } = await import('@/lib/db');
    const { inArray } = await import('drizzle-orm');
    const db = await getDb();
    const real = await db.select({ id: orderItems.id }).from(orderItems)
      .where(inArray(orderItems.id, itemIds));

    expect(itemIds.length).toBeGreaterThan(0);
    expect(real.map((r) => r.id).sort()).toEqual([...itemIds].sort());
    // ...and this order's own failed line is among them.
    const mine = (await itemsOfOrder(orderId)).map((i) => i.id);
    expect(itemIds.some((id) => mine.includes(id))).toBe(true);
  });

  it('lists the customer\'s SUCCESSFUL items too, so the whole payment is not refunded', async () => {
    await batchWithRefunds();
    const wb = await refundWorkbook();
    const products = cellsOf(wb, 'Successful Items', 7).map(String);

    expect(products.some((p) => p.includes('S19-ok'))).toBe(true);
    expect(products.some((p) => p.includes('S19-bad'))).toBe(false);
  });

  it('never puts a successful item on the failed sheet', async () => {
    await batchWithRefunds();
    const wb = await refundWorkbook();
    const failed = cellsOf(wb, 'Items to Refund', 8).map(String);
    expect(failed.some((p) => p.includes('S19-ok'))).toBe(false);
  });

  it('formats money as numbers with PHP currency, not strings', async () => {
    await batchWithRefunds();
    const wb = await refundWorkbook();
    const ws = wb.getWorksheet('Refund Summary')!;
    expect(typeof ws.getRow(2).getCell(13).value).toBe('number');
    expect(ws.getColumn(13).numFmt).toBe('"₱"#,##0.00');
  });

  it('reports the batch summary with both quantity figures', async () => {
    const { bad } = await batchWithRefunds();
    const wb = await refundWorkbook();
    const ws = wb.getWorksheet('Batch Summary')!;
    let found: { needed: unknown; slots: unknown; outcome: unknown } | null = null;
    ws.eachRow((row, n) => {
      if (n > 1 && String(row.getCell(1).value ?? '').includes('S19-bad')) {
        found = { needed: row.getCell(8).value, slots: row.getCell(9).value, outcome: row.getCell(10).value };
      }
    });
    // 5 combined -> needs 2 to qualify, 5 slots left. Both, separately.
    expect(found).toEqual({ needed: 2, slots: 5, outcome: 'FAILED' });
    void bad;
  });

  it('refuses rather than emitting an empty workbook', async () => {
    await asAdmin();
    const res = await REFUND_XLSX(new Request(
      'http://localhost/api/admin/report/pasalo-refund/xlsx?from=2020-01-01&to=2020-01-02',
    ));
    expect(res.status).toBe(404);
  });
});

describe('SCENARIO 29 — authorisation on every admin surface', () => {
  const asCustomer = async () => {
    const c = await makeCustomer('e2e-intruder');
    session.current = { sub: c.id, role: 'customer', email: c.email };
  };

  it('refuses a customer opening the stage', async () => {
    await asCustomer();
    const res = await OPEN_PASALO(new Request('http://localhost/x', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(403);
  });

  it('refuses a customer closing the stage', async () => {
    await asCustomer();
    expect((await CLOSE_PASALO()).status).toBe(403);
  });

  it('refuses a customer reading the refund report', async () => {
    await asCustomer();
    const res = await REFUND_JSON(new Request(
      `http://localhost/api/admin/report/pasalo-refund?from=${today()}&to=${today()}`,
    ));
    expect(res.status).toBe(403);
  });

  it('refuses a customer downloading the workbook', async () => {
    await asCustomer();
    const res = await REFUND_XLSX(new Request(
      `http://localhost/api/admin/report/pasalo-refund/xlsx?from=${today()}&to=${today()}`,
    ));
    expect(res.status).toBe(403);
  });

  it('refuses a customer marking a refund complete', async () => {
    await asCustomer();
    const res = await MARK_REFUND(
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ status: 'refunded', reference: 'X' }) }),
      { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) },
    );
    expect(res.status).toBe(403);
  });

  it('refuses an anonymous caller on every one of them', async () => {
    session.current = null;
    expect((await OPEN_PASALO(new Request('http://localhost/x', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await CLOSE_PASALO()).status).toBe(401);
    expect((await REFUND_JSON(new Request(`http://localhost/y?from=${today()}&to=${today()}`))).status).toBe(401);
  });
});

describe('SCENARIO 30 — the original Kahati flow still works', () => {
  it('joins, checks out with proof, and lands in proof_review awaiting verification', async () => {
    const { counterId, perVialPhp } = await makeKahatiProduct('S30', { pricePerKitPhp: 5500 });
    const customer = await makeCustomer('e2e-regression');

    const { status, orderId } = await join(customer, counterId, 2);

    expect(status).toBe(201);
    const order = await orderRow(orderId!);
    expect(order.buyType).toBe('kahati');
    expect(order.status).toBe('proof_review');
    expect(order.paymentStatus).toBe('proof_submitted');
    expect(Number(order.subtotalPhp)).toBe(perVialPhp * 2);
    // Packing fee charged at checkout, on top of the goods.
    expect(Number(order.packingFeePhp)).toBe(150);
    expect(Number(order.totalPhp)).toBe(perVialPhp * 2 + 150);
    expect(Number(order.downpaymentPhp)).toBe(150);
    expect(order.cycleKey).not.toBeNull();
    expect((await counterRow(counterId)).claimedSlots).toBe(2);
  });

  it('charges the cycle packing fee once across a second commitment', async () => {
    const one = await makeKahatiProduct('S30-a');
    const two = await makeKahatiProduct('S30-b');
    const customer = await makeCustomer('e2e-cycle-fee');

    const first = await join(customer, one.counterId, 1);
    const second = await join(customer, two.counterId, 1);

    expect(Number((await orderRow(first.orderId!)).packingFeePhp)).toBe(150);
    // Second commitment in the same cycle: one parcel, one fee.
    expect(Number((await orderRow(second.orderId!)).packingFeePhp)).toBe(0);
    expect((await orderRow(second.orderId!)).paymentStatus).toBe('not_due');
  });

  it('refuses a checkout with no payment proof', async () => {
    const { counterId } = await makeKahatiProduct('S30-noproof');
    const customer = await makeCustomer('e2e-noproof');
    asUser(customer);

    const res = await CHECKOUT(checkoutRequest(checkoutForm(
      [{ kind: 'group_buy', refId: counterId, qty: 1 }], { withProof: false },
    )));

    expect(res.status).toBe(400);
    expect((await counterRow(counterId)).claimedSlots).toBe(0);
  });

  it('replays a resubmitted checkout instead of duplicating the order', async () => {
    const { counterId } = await makeKahatiProduct('S30-idem');
    const customer = await makeCustomer('e2e-idem');
    asUser(customer);
    const key = 'e2e-idempotency-key-1234';

    const first = await CHECKOUT(checkoutRequest(checkoutForm(
      [{ kind: 'group_buy', refId: counterId, qty: 2 }], { idempotencyKey: key },
    )));
    const second = await CHECKOUT(checkoutRequest(checkoutForm(
      [{ kind: 'group_buy', refId: counterId, qty: 2 }], { idempotencyKey: key },
    )));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json()).data.orderNo;
    const b = (await second.json()).data.orderNo;
    expect(a).toBe(b);
    // No double claim.
    expect((await counterRow(counterId)).claimedSlots).toBe(2);
  });

  it('still keeps the customer\'s line items after a cancellation', async () => {
    const { counterId } = await makeKahatiProduct('S30-cancel');
    const customer = await makeCustomer('e2e-cancel-hist');
    const { orderId } = await join(customer, counterId, 1);

    await asAdmin();
    await SET_ORDER_STATUS(
      new Request(`http://localhost/x`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }),
      { params: Promise.resolve({ id: orderId! }) },
    );

    expect((await itemsOfOrder(orderId!))).toHaveLength(1);
    expect((await orderRow(orderId!)).status).toBe('cancelled');
  });
});
