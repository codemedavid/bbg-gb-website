import { describe, it, expect } from 'vitest';
import type { Workbook, Worksheet } from 'exceljs';
import { buildRefundWorkbook, type RefundWorkbookInput } from './pasalo-refund-xlsx';
import {
  buildCustomerRefundRows, buildBatchSummaryRows, buildBatchTotals,
  type RefundRecord, type SuccessfulItem, type CounterOutcome,
} from './pasalo-refund';

const refund = (over: Partial<RefundRecord> = {}): RefundRecord => ({
  id: 'r1', orderItemId: 'i1', orderId: 'o1', orderNo: 'KH-1001', groupBuyId: 'gB',
  userId: 'u1', customerName: 'Juan Dela Cruz', customerEmail: 'juan@example.com',
  customerPhone: '09171234567', shipName: 'Juan Dela Cruz', shipPhone: '09171234567',
  productName: 'Cagrilintide 5mg — kahati', qty: 1, unitPricePhp: 550, lineTotalPhp: 550,
  goodsPhp: 550, depositPhp: 150, amountPhp: 700, collectedBasis: 'settlement_paid',
  reason: 'Final combined quantity 5/7 minimum after Pasalo closed (3 Kahati + 2 Pasalo).',
  kahatiVials: 3, pasaloVials: 2, combinedVials: 5, minRequired: 7,
  status: 'pending', reference: null, method: null, refundAccount: null,
  refundedAt: null, notes: null, paymentMethod: 'GCash', orderedOn: '2026-09-01', ...over,
});

const success = (over: Partial<SuccessfulItem> = {}): SuccessfulItem => ({
  userId: 'u1', groupBuyId: 'gA', customerName: 'Juan Dela Cruz',
  customerEmail: 'juan@example.com', customerPhone: '09171234567',
  orderNo: 'KH-1001', orderItemId: 'ok1', productName: 'Retatrutide 15mg — kahati',
  qty: 2, unitPricePhp: 550, lineTotalPhp: 1100,
  kahatiVials: 9, pasaloVials: 0, combinedVials: 9, minRequired: 7,
  fulfilmentStatus: 'payment_confirmed', ...over,
});

const counter = (over: Partial<CounterOutcome> = {}): CounterOutcome => ({
  groupBuyId: 'gB', productName: 'Cagrilintide 5mg', kahatiVials: 3, pasaloVials: 2,
  combinedVials: 5, minRequired: 7, maxVials: 10, neededToQualify: 2, slotsRemaining: 5,
  status: 'cancelled', paymentConfirmedVials: 4, ...over,
});

function inputFor(
  refunds: RefundRecord[], successful: SuccessfulItem[], counters: CounterOutcome[],
): RefundWorkbookInput {
  const batch = buildBatchSummaryRows(counters, refunds, successful);
  return {
    batchLabel: 'Batch 7',
    generatedAt: new Date('2026-09-05T08:00:00Z'),
    customers: buildCustomerRefundRows(refunds, successful),
    refunds,
    successful,
    batch,
    totals: buildBatchTotals(batch, refunds),
  };
}

const build = () => buildRefundWorkbook(inputFor(
  [refund()],
  [success()],
  [counter(), counter({ groupBuyId: 'gA', productName: 'Retatrutide 15mg', combinedVials: 9, kahatiVials: 9, pasaloVials: 0, neededToQualify: 0, slotsRemaining: 1, status: 'closed', paymentConfirmedVials: 9 })],
));

const sheetNames = (wb: Workbook): string[] => wb.worksheets.map((s) => s.name);
const headerOf = (sheet: Worksheet): string[] =>
  (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v));
const cell = (sheet: Worksheet, row: number, col: number): unknown => sheet.getRow(row).getCell(col).value;

describe('buildRefundWorkbook — structure', () => {
  it('produces the four named sheets, refund summary first', async () => {
    expect(sheetNames(await build()))
      .toEqual(['Refund Summary', 'Items to Refund', 'Successful Items', 'Batch Summary']);
  });

  it('freezes the header row on every sheet', async () => {
    const wb = await build();
    for (const sheet of wb.worksheets) {
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    }
  });

  it('bolds the header row on every sheet', async () => {
    const wb = await build();
    for (const sheet of wb.worksheets) {
      expect(sheet.getRow(1).font?.bold).toBe(true);
    }
  });

  it('puts a filter over the headers on every sheet', async () => {
    const wb = await build();
    for (const sheet of wb.worksheets) {
      expect(sheet.autoFilter).toMatchObject({ from: { row: 1, column: 1 } });
    }
  });

  it('gives every column a width, so nothing opens truncated', async () => {
    const wb = await build();
    for (const sheet of wb.worksheets) {
      for (const column of sheet.columns ?? []) {
        expect(column.width).toBeGreaterThan(8);
      }
    }
  });

  it('writes a real xlsx package that opens as a workbook', async () => {
    // The requirement was a genuine .xlsx, not HTML with the extension changed.
    // A zip container starting "PK" is what Excel and Sheets both actually read.
    const buffer = await (await build()).xlsx.writeBuffer();
    const head = Buffer.from(buffer.slice(0, 2));
    expect(head.toString('latin1')).toBe('PK');
    expect(buffer.byteLength).toBeGreaterThan(2000);
  });
});

describe('buildRefundWorkbook — money and dates are values, not strings', () => {
  it('writes refund amounts as numbers a column can be summed on', async () => {
    const sheet = (await build()).getWorksheet('Refund Summary')!;
    // Column 13 is TOTAL TO REFUND: ₱550 goods + ₱150 deposit.
    expect(cell(sheet, 2, 13)).toBe(700);
    expect(typeof cell(sheet, 2, 13)).toBe('number');
  });

  it('formats every money column as PHP currency', async () => {
    const sheet = (await build()).getWorksheet('Refund Summary')!;
    expect(sheet.getColumn(13).numFmt).toBe('"₱"#,##0.00');
  });

  it('formats the refunded-at column as a date', async () => {
    const sheet = (await build()).getWorksheet('Refund Summary')!;
    expect(sheet.getColumn(17).numFmt).toBe('yyyy-mm-dd hh:mm');
  });
});

describe('buildRefundWorkbook — Sheet 1, one row per customer', () => {
  it('names TOTAL TO REFUND as its own column', async () => {
    const sheet = (await build()).getWorksheet('Refund Summary')!;
    expect(headerOf(sheet)).toContain('TOTAL TO REFUND');
  });

  it('collapses a customer with several failed lines into ONE row', async () => {
    // An admin working a list that names the same person twice sends two
    // transfers, so this is the property the sheet exists for.
    const wb = await buildRefundWorkbook(inputFor(
      [refund({ id: 'a', orderItemId: 'a', depositPhp: 150, amountPhp: 700 }),
        refund({ id: 'b', orderItemId: 'b', orderNo: 'KH-1042', depositPhp: 0, amountPhp: 550 })],
      [], [counter()],
    ));
    const sheet = wb.getWorksheet('Refund Summary')!;
    // Header + one customer + totals.
    expect(sheet.rowCount).toBe(3);
    expect(cell(sheet, 2, 5)).toBe('KH-1001, KH-1042');
    expect(cell(sheet, 2, 13)).toBe(1250);
  });

  it('closes with a totals row carrying the money', async () => {
    const sheet = (await build()).getWorksheet('Refund Summary')!;
    const last = sheet.getRow(sheet.rowCount);
    expect(last.getCell(1).value).toBe('TOTAL');
    expect(last.getCell(13).value).toBe(700);
    expect(last.font?.bold).toBe(true);
  });

  it('tints a pending customer differently from a refunded one', async () => {
    const wb = await buildRefundWorkbook(inputFor(
      [refund({ id: 'a', orderItemId: 'a', userId: 'u1', shipName: 'Ana' }),
        refund({ id: 'b', orderItemId: 'b', userId: 'u2', shipName: 'Ben', status: 'refunded' })],
      [], [counter()],
    ));
    const sheet = wb.getWorksheet('Refund Summary')!;
    const fillOf = (row: number) => (sheet.getRow(row).getCell(1).fill as { fgColor: { argb: string } }).fgColor.argb;
    expect(fillOf(2)).not.toBe(fillOf(3));
  });
});

describe('buildRefundWorkbook — Sheet 2, the evidence', () => {
  it('carries the failure reason verbatim onto every failed line', async () => {
    const sheet = (await build()).getWorksheet('Items to Refund')!;
    expect(cell(sheet, 2, 20))
      .toBe('Final combined quantity 5/7 minimum after Pasalo closed (3 Kahati + 2 Pasalo).');
  });

  it('shows the Kahati / Pasalo / combined split behind that reason', async () => {
    const sheet = (await build()).getWorksheet('Items to Refund')!;
    expect(cell(sheet, 2, 16)).toBe(3);
    expect(cell(sheet, 2, 17)).toBe(2);
    expect(cell(sheet, 2, 18)).toBe(5);
    expect(cell(sheet, 2, 19)).toBe(7);
  });

  it('says WHY the amount is what it is, not just what it is', async () => {
    // Without this column a ₱0 refund on an unpaid order looks like a mistake,
    // and a ₱550 one looks unjustified.
    const sheet = (await build()).getWorksheet('Items to Refund')!;
    expect(cell(sheet, 2, 12)).toBe('Settlement paid — goods collected');
  });

  it('carries the traceable ids so any row can be chased back', async () => {
    const sheet = (await build()).getWorksheet('Items to Refund')!;
    expect(cell(sheet, 2, 4)).toBe('u1');
    expect(cell(sheet, 2, 5)).toBe('KH-1001');
    expect(cell(sheet, 2, 6)).toBe('i1');
  });
});

describe('buildRefundWorkbook — Sheet 3, what still ships', () => {
  it('lists the refunded customer\'s successful items', async () => {
    const sheet = (await build()).getWorksheet('Successful Items')!;
    expect(cell(sheet, 2, 7)).toBe('Retatrutide 15mg — kahati');
    expect(cell(sheet, 2, 10)).toBe(1100);
  });

  it('says in the row itself not to refund it', async () => {
    // The sheet exists to prevent an admin refunding a customer's whole
    // payment, so the instruction belongs on the row, not in a preamble.
    const sheet = (await build()).getWorksheet('Successful Items')!;
    expect(String(cell(sheet, 2, 16))).toContain('do not refund');
  });
});

describe('buildRefundWorkbook — Sheet 4, the batch', () => {
  it('reports needed-to-qualify and slots-remaining as separate columns', async () => {
    // The two figures the whole feature turns on: at 5/10 the batch needs 2
    // more and has 5 slots left, and one column cannot say both.
    const sheet = (await build()).getWorksheet('Batch Summary')!;
    const header = headerOf(sheet);
    expect(header).toContain('Needed to Qualify');
    expect(header).toContain('Slots Remaining');
    expect(cell(sheet, 2, 8)).toBe(2);
    expect(cell(sheet, 2, 9)).toBe(5);
  });

  it('shows payment-confirmed vials beside the committed total', async () => {
    // Vials are counted at checkout, before anyone verifies a peso. The gap is
    // the admin's warning that a batch is resting on unverified money.
    const sheet = (await build()).getWorksheet('Batch Summary')!;
    expect(cell(sheet, 2, 4)).toBe(5);
    expect(cell(sheet, 2, 5)).toBe(4);
  });

  it('marks failed and successful products differently', async () => {
    const sheet = (await build()).getWorksheet('Batch Summary')!;
    expect(cell(sheet, 2, 10)).toBe('FAILED');
    expect(cell(sheet, 3, 10)).toBe('SUCCESS');
    const fillOf = (row: number) => (sheet.getRow(row).getCell(1).fill as { fgColor: { argb: string } }).fgColor.argb;
    expect(fillOf(2)).not.toBe(fillOf(3));
  });

  it('closes with batch-wide totals', async () => {
    const wb = await build();
    const sheet = wb.getWorksheet('Batch Summary')!;
    const totals = sheet.getRow(4);
    expect(String(totals.getCell(1).value)).toContain('2 products');
    expect(String(totals.getCell(10).value)).toBe('1 ok / 1 failed');
    expect(totals.getCell(11).value).toBe(1);
    expect(totals.getCell(13).value).toBe(700);
  });

  it('states that downloading the file refunds nothing', async () => {
    // Requirement: exporting is not proof that money was returned.
    const sheet = (await build()).getWorksheet('Batch Summary')!;
    const text = (sheet.getRow(sheet.rowCount).getCell(1).value ?? '').toString();
    expect(text).toContain('does not mark anything refunded');
  });
});
