// THE FULL WALKTHROUGH — one realistic batch, start to finish.
//
// Customers A, B, C join Kahati. The admin ends it. Customers D and E take
// Pasalo slots. One product is rescued to exactly 7, one fills to 10, one stays
// at 5. The admin closes the stage, the refund report is generated, one refund
// is marked paid, and the workbook is exported again.
//
// Every stage is verified against the DATABASE, not against a status code.
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
const { GET: PASALO_BOARD } = await import('./route');
const { resetDb } = await import('@/lib/test/harness');
const {
  makeCustomer, makeKahatiProduct, checkoutForm, checkoutRequest, openStorefront,
  counterRow, orderRow, allRefunds, settleOrder,
} = await import('@/lib/test/pasalo-e2e');
const { counterQuantities } = await import('@/lib/kahati-quantity');

beforeEach(async () => {
  await resetDb();
  await openStorefront();
  session.current = null;
});

type Customer = { id: string; email: string; role: 'customer' | 'admin' };

async function asAdmin() {
  const admin = await makeCustomer('walk-admin');
  const { getDb, users } = await import('@/lib/db');
  const { eq } = await import('drizzle-orm');
  const db = await getDb();
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
}

async function joinMany(user: Customer, lines: { counterId: string; qty: number }[]) {
  session.current = { sub: user.id, role: user.role, email: user.email };
  const res = await CHECKOUT(checkoutRequest(checkoutForm(
    lines.map((l) => ({ kind: 'group_buy', refId: l.counterId, qty: l.qty })),
  )));
  const body = await res.json();
  expect(res.status).toBe(201);
  return body.data.order.id as string;
}

async function confirmPayment(orderId: string) {
  await asAdmin();
  await SET_ORDER_STATUS(
    new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ status: 'payment_confirmed' }) }),
    { params: Promise.resolve({ id: orderId }) },
  );
}

const today = () => manilaYmd(new Date());

async function workbook(): Promise<Workbook> {
  await asAdmin();
  const res = await REFUND_XLSX(new Request(
    `http://localhost/x?from=${today()}&to=${today()}&batchLabel=E2E-TEST-BBG`,
  ));
  expect(res.status).toBe(200);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return wb;
}

describe('FULL WALKTHROUGH — Kahati → report → Pasalo → close → refund → export', () => {
  it('carries one batch through every stage with the right outcome for each product', async () => {
    // ---- Setup: three products on the Kahati board ------------------------
    const rescued = await makeKahatiProduct('WALK-rescued', { pricePerKitPhp: 5500 }); // → 7
    const filled = await makeKahatiProduct('WALK-filled', { pricePerKitPhp: 7000 });   // → 10
    const doomed = await makeKahatiProduct('WALK-doomed', { pricePerKitPhp: 6000 });   // → 5

    // ---- Stage 1: customers A, B, C join Kahati ---------------------------
    const a = await makeCustomer('walk-A');
    const b = await makeCustomer('walk-B');
    const c = await makeCustomer('walk-C');

    const orderA = await joinMany(a, [
      { counterId: rescued.counterId, qty: 2 },
      { counterId: doomed.counterId, qty: 2 },
    ]);
    const orderB = await joinMany(b, [
      { counterId: rescued.counterId, qty: 2 },
      { counterId: filled.counterId, qty: 4 },
    ]);
    const orderC = await joinMany(c, [
      { counterId: filled.counterId, qty: 4 },
      { counterId: doomed.counterId, qty: 3 },
    ]);
    for (const id of [orderA, orderB, orderC]) await confirmPayment(id);

    expect((await counterRow(rescued.counterId)).claimedSlots).toBe(4);
    expect((await counterRow(filled.counterId)).claimedSlots).toBe(8);
    expect((await counterRow(doomed.counterId)).claimedSlots).toBe(5);

    // ---- Stage 2: admin ends Kahati; the report says who needs help -------
    await asAdmin();
    const opened = await OPEN_PASALO(new Request('http://localhost/x', {
      method: 'POST', body: JSON.stringify({}),
    }));
    expect((await opened.json()).data.opened).toBe(3);

    session.current = null;
    const boardRes = await PASALO_BOARD();
    const board = (await boardRes.json()).data;
    // Ranked by how close each is to rescue: filled (needs 0... sinks), then by gap.
    const byName = Object.fromEntries(board.map((r: { name: string }) => [r.name.split(' ')[1], r]));
    expect(byName['WALK-rescued']).toMatchObject({ neededToQualify: 3, slotsRemaining: 6, kahatiVials: 4 });
    expect(byName['WALK-doomed']).toMatchObject({ neededToQualify: 2, slotsRemaining: 5, kahatiVials: 5 });
    expect(byName['WALK-filled']).toMatchObject({ neededToQualify: 0, slotsRemaining: 2, kahatiVials: 8 });

    // ---- Stage 3: customers D and E take Pasalo slots ---------------------
    const d = await makeCustomer('walk-D');
    const e = await makeCustomer('walk-E');
    const orderD = await joinMany(d, [{ counterId: rescued.counterId, qty: 3 }]); // 4 → 7
    const orderE = await joinMany(e, [{ counterId: filled.counterId, qty: 2 }]);  // 8 → 10
    await confirmPayment(orderD);
    await confirmPayment(orderE);

    const afterPasalo = {
      rescued: counterQuantities(await counterRow(rescued.counterId)),
      filled: counterQuantities(await counterRow(filled.counterId)),
      doomed: counterQuantities(await counterRow(doomed.counterId)),
    };
    expect(afterPasalo.rescued).toMatchObject({ kahatiVials: 4, pasaloVials: 3, combinedVials: 7, state: 'qualified' });
    expect(afterPasalo.filled).toMatchObject({ kahatiVials: 8, pasaloVials: 2, combinedVials: 10, state: 'full' });
    expect(afterPasalo.doomed).toMatchObject({ kahatiVials: 5, pasaloVials: 0, combinedVials: 5, state: 'short' });

    // Every settled customer has paid their balance, so failed goods are owed back.
    for (const id of [orderA, orderB, orderC, orderD, orderE]) await settleOrder(id);

    // ---- Stage 4: admin closes Pasalo; final evaluation -------------------
    await asAdmin();
    const closeRes = await CLOSE_PASALO();
    const close = (await closeRes.json()).data;

    // ONE fulfilled here, not two: the counter that filled to 10 during Pasalo
    // sealed itself at that checkout (sealFullPasalo) rather than waiting — ten
    // vials clears any minimum, so 'closed' is exactly the outcome this close
    // would have reached for it, arrived at earlier. The close then has only
    // the two still-staged counters left to decide.
    expect(close.fulfilled).toBe(1);
    expect(close.failed).toBe(1);

    expect((await counterRow(rescued.counterId)).status).toBe('closed');  // reached 7 → SUCCESS
    expect((await counterRow(filled.counterId)).status).toBe('closed');   // reached 10 → FULL
    expect((await counterRow(doomed.counterId)).status).toBe('cancelled'); // stayed 5 → FAILED

    // ---- Stage 5: refunds — only the doomed product -----------------------
    const refunds = await allRefunds();
    expect(new Set(refunds.map((r) => r.groupBuyId))).toEqual(new Set([doomed.counterId]));
    // A ordered 2 doomed vials (₱600/vial), C ordered 3.
    const byUser = Object.fromEntries(refunds.map((r) => [r.userId, r]));
    expect(Number(byUser[a.id].goodsPhp)).toBe(1200);
    expect(Number(byUser[c.id].goodsPhp)).toBe(1800);
    // B, D and E lost nothing, so they are owed nothing.
    expect(refunds.some((r) => [b.id, d.id, e.id].includes(r.userId))).toBe(false);

    // Neither A nor C has their order cancelled — both still ship other products.
    expect((await orderRow(orderA)).status).not.toBe('cancelled');
    expect((await orderRow(orderC)).status).not.toBe('cancelled');
    // ...and both are re-billed for the survivors alone.
    expect(Number((await orderRow(orderA)).subtotalPhp)).toBe(2 * 550);       // rescued only
    expect(Number((await orderRow(orderC)).subtotalPhp)).toBe(4 * 700);       // filled only

    // Deposits stay with us: both still have a parcel coming.
    expect(Number(byUser[a.id].depositPhp)).toBe(0);
    expect(Number(byUser[c.id].depositPhp)).toBe(0);

    // ---- Stage 6: the report agrees with the database ---------------------
    await asAdmin();
    const reportRes = await REFUND_JSON(new Request(`http://localhost/x?from=${today()}&to=${today()}`));
    const report = (await reportRes.json()).data;

    expect(report.totals.customersRequiringRefund).toBe(2);
    expect(report.totals.refundValuePhp).toBe(3000);
    expect(report.totals.successfulProducts).toBe(2);
    expect(report.totals.failedProducts).toBe(1);

    const rowA = report.customers.find((r: { userId: string }) => r.userId === a.id);
    expect(rowA.totalRefundPhp).toBe(1200);
    expect(rowA.successfulPhp).toBe(1100);   // 2 rescued vials at ₱550
    expect(rowA.relevantPaidPhp).toBe(2300); // 1200 failed + 1100 successful

    // ---- Stage 7: the workbook agrees with both ---------------------------
    const wb = await workbook();
    expect(wb.worksheets.map((s) => s.name))
      .toEqual(['Refund Summary', 'Items to Refund', 'Successful Items', 'Batch Summary']);

    const summary = wb.getWorksheet('Refund Summary')!;
    let sheetTotal = 0;
    summary.eachRow((row, n) => {
      if (n === 1 || String(row.getCell(1).value ?? '').startsWith('TOTAL')) return;
      sheetTotal += Number(row.getCell(13).value ?? 0);
    });
    expect(sheetTotal).toBe(report.totals.refundValuePhp);

    // Every failed row belongs to the doomed product; no successful one leaked in.
    const failedProducts: string[] = [];
    wb.getWorksheet('Items to Refund')!.eachRow((row, n) => {
      if (n === 1 || String(row.getCell(1).value ?? '').startsWith('TOTAL')) return;
      failedProducts.push(String(row.getCell(8).value));
    });
    expect(failedProducts.every((p) => p.includes('WALK-doomed'))).toBe(true);

    // The successful sheet carries what these customers still get, including
    // the counter that FILLED during Kahati and never entered the stage.
    const successProducts: string[] = [];
    wb.getWorksheet('Successful Items')!.eachRow((row, n) => {
      if (n === 1 || String(row.getCell(1).value ?? '').startsWith('TOTAL')) return;
      successProducts.push(String(row.getCell(7).value));
    });
    expect(successProducts.some((p) => p.includes('WALK-rescued'))).toBe(true);
    expect(successProducts.some((p) => p.includes('WALK-filled'))).toBe(true);
    expect(successProducts.some((p) => p.includes('WALK-doomed'))).toBe(false);

    // ---- Stage 8: mark one refund paid, then re-export --------------------
    const refundA = refunds.find((r) => r.userId === a.id)!;
    await asAdmin();
    const marked = await MARK_REFUND(
      new Request('http://localhost/x', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'refunded', reference: 'GC-WALK-001', method: 'GCash' }),
      }),
      { params: Promise.resolve({ id: refundA.id }) },
    );
    expect(marked.status).toBe(200);

    const after = await allRefunds();
    expect(after.find((r) => r.id === refundA.id)!.status).toBe('refunded');
    // C is untouched and still owed.
    expect(after.find((r) => r.userId === c.id)!.status).toBe('pending');
    // No row was duplicated by any of it.
    expect(new Set(after.map((r) => r.orderItemId)).size).toBe(after.length);

    const wb2 = await workbook();
    const statuses: string[] = [];
    wb2.getWorksheet('Refund Summary')!.eachRow((row, n) => {
      if (n === 1 || String(row.getCell(1).value ?? '').startsWith('TOTAL')) return;
      statuses.push(String(row.getCell(14).value));
    });
    expect(statuses).toContain('Refunded');
    expect(statuses).toContain('Pending');
  });
});
