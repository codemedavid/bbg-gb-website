// Renders the Pasalo refund determination to a real .xlsx workbook.
//
// A real one: ExcelJS writing a genuine OOXML package, not an HTML table with a
// spreadsheet extension. The team works this file — sorting by amount,
// filtering to the unpaid, summing a column to reconcile against the bank — and
// none of that works on markup. Money is therefore written as NUMBERS carrying
// a currency format, never as pre-formatted strings.
//
// Built SERVER-side, unlike the weekly report which the browser assembles. This
// one decides who gets money: the figures have to be reproducible byte for
// byte, the workbook must never be re-derivable from whatever a page happens to
// be holding, and ExcelJS's ~22MB has no business in an admin bundle. The route
// streams the result and the browser only ever receives a file.
//
// ExcelJS is still loaded through a dynamic import so a stray client-side
// import of this module cannot drag the library into a page chunk.
import type { Workbook, Worksheet } from 'exceljs';
import { REPORT_COLORS } from './constants';
import type {
  RefundRecord, SuccessfulItem, CustomerRefundRow, BatchSummaryRow, BatchTotals,
} from './pasalo-refund';
import { COLLECTED_BASIS_LABEL, REFUND_STATUS_LABEL } from '../refund-status';

// Excel and Google Sheets both render the peso sign from a quoted literal; the
// bare ₱ in a format string is locale-dependent and silently becomes a hash in
// some builds.
const PHP_FORMAT = '"₱"#,##0.00';
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';
const INT_FORMAT = '#,##0';

const argb = ([r, g, b]: [number, number, number]): string =>
  'FF' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();

// Row tints. Deliberately pale: a sheet where every row shouts is a sheet
// nobody can scan, and these have to stay readable behind the header fill and
// the table's own banding.
const TINT_PENDING = 'FFFDF3D8';   // money still to send
const TINT_REFUNDED = 'FFE8F5DB';  // done
const TINT_FAILED = 'FFF9E2E2';    // a product that did not make it
const TINT_SUCCESS = 'FFEFF6E7';   // a product that did

type Column = {
  header: string;
  width: number;
  /** Cell number format, when the column is not text. */
  numFmt?: string;
};

function layout(sheet: Worksheet, columns: Column[]): void {
  sheet.columns = columns.map((c) => ({ header: c.header, width: c.width }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: argb(REPORT_COLORS.headerText) } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.headerFill) } };
  headerRow.alignment = { vertical: 'middle', wrapText: true };
  headerRow.height = 28;

  columns.forEach((c, i) => {
    if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt;
  });

  // Filters over the header, and the header frozen. Both are what make a long
  // sheet workable: the team slices by status without setting anything up, and
  // scrolling to row 300 still shows what the columns are.
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function tint(sheet: Worksheet, rowNumber: number, color: string, span: number): void {
  const row = sheet.getRow(rowNumber);
  for (let c = 1; c <= span; c++) {
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }
}

function totalsRow(sheet: Worksheet, cells: (string | number | null)[]): void {
  const row = sheet.addRow(cells);
  row.font = { bold: true };
  for (let c = 1; c <= cells.length; c++) {
    row.getCell(c).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.totalFill) },
    };
  }
}

export type RefundWorkbookInput = {
  batchLabel: string;
  generatedAt: Date;
  customers: CustomerRefundRow[];
  refunds: RefundRecord[];
  successful: SuccessfulItem[];
  batch: BatchSummaryRow[];
  totals: BatchTotals;
};

export async function buildRefundWorkbook(input: RefundWorkbookInput): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BBG Peptides';
  workbook.created = input.generatedAt;

  addRefundSummarySheet(workbook, input);
  addFailedItemsSheet(workbook, input);
  addSuccessfulItemsSheet(workbook, input);
  addBatchSummarySheet(workbook, input);

  return workbook;
}

// ---- Sheet 1 -------------------------------------------------------------
// One row per person to pay. This is the sheet refunds are actually worked
// from, so it opens first.
const SUMMARY_COLUMNS: Column[] = [
  { header: 'Customer Name', width: 26 },
  { header: 'Customer ID', width: 38 },
  { header: 'Phone Number', width: 16 },
  { header: 'Email', width: 28 },
  { header: 'Order Number(s)', width: 22 },
  { header: 'Batch', width: 18 },
  { header: 'Payment Method', width: 16 },
  { header: 'Failed Items', width: 12, numFmt: INT_FORMAT },
  { header: 'Relevant Amount', width: 16, numFmt: PHP_FORMAT },
  { header: 'Successful Amount', width: 17, numFmt: PHP_FORMAT },
  { header: 'Goods Refund', width: 15, numFmt: PHP_FORMAT },
  { header: 'Deposit Refund', width: 15, numFmt: PHP_FORMAT },
  { header: 'TOTAL TO REFUND', width: 18, numFmt: PHP_FORMAT },
  { header: 'Refund Status', width: 14 },
  { header: 'Refund Account', width: 22 },
  { header: 'Refund Reference', width: 20 },
  { header: 'Refunded At', width: 18, numFmt: DATE_FORMAT },
  { header: 'Admin Notes', width: 34 },
];

function addRefundSummarySheet(workbook: Workbook, input: RefundWorkbookInput): void {
  const sheet = workbook.addWorksheet('Refund Summary');
  layout(sheet, SUMMARY_COLUMNS);

  for (const c of input.customers) {
    const row = sheet.addRow([
      c.customerName, c.userId, c.customerPhone, c.customerEmail, c.orderNos,
      input.batchLabel, c.paymentMethods, c.failedItems,
      c.relevantPaidPhp, c.successfulPhp, c.goodsRefundPhp, c.depositRefundPhp, c.totalRefundPhp,
      REFUND_STATUS_LABEL[c.status], c.refundAccount, c.reference, c.refundedAt, c.notes,
    ]);
    tint(sheet, row.number, c.status === 'refunded' ? TINT_REFUNDED : TINT_PENDING, SUMMARY_COLUMNS.length);
    // The one figure the whole file exists to communicate.
    row.getCell(13).font = { bold: true };
  }

  totalsRow(sheet, [
    'TOTAL', null, null, null, null, null, null,
    input.refunds.length,
    null, null,
    round(input.customers.reduce((s, c) => s + c.goodsRefundPhp, 0)),
    round(input.customers.reduce((s, c) => s + c.depositRefundPhp, 0)),
    round(input.customers.reduce((s, c) => s + c.totalRefundPhp, 0)),
    `${input.totals.customersRequiringRefund} customer(s)`,
    null, null, null, null,
  ]);
}

// ---- Sheet 2 -------------------------------------------------------------
// One row per failed line: the evidence behind every peso on sheet 1.
const FAILED_COLUMNS: Column[] = [
  { header: 'Customer Name', width: 26 },
  { header: 'Phone Number', width: 16 },
  { header: 'Email', width: 28 },
  { header: 'Customer ID', width: 38 },
  { header: 'Order Number', width: 14 },
  { header: 'Order Item ID', width: 38 },
  { header: 'Batch', width: 18 },
  { header: 'Product', width: 34 },
  { header: 'Qty Ordered', width: 12, numFmt: INT_FORMAT },
  { header: 'Unit Price', width: 13, numFmt: PHP_FORMAT },
  { header: 'Subtotal', width: 13, numFmt: PHP_FORMAT },
  { header: 'Amount Collected For', width: 22 },
  { header: 'Goods Refund', width: 14, numFmt: PHP_FORMAT },
  { header: 'Deposit Refund', width: 14, numFmt: PHP_FORMAT },
  { header: 'Refund Amount', width: 15, numFmt: PHP_FORMAT },
  { header: 'Kahati Qty', width: 11, numFmt: INT_FORMAT },
  { header: 'Pasalo Qty', width: 11, numFmt: INT_FORMAT },
  { header: 'Final Combined Qty', width: 16, numFmt: INT_FORMAT },
  { header: 'Minimum Required', width: 16, numFmt: INT_FORMAT },
  { header: 'Failure Reason', width: 62 },
  { header: 'Payment Method', width: 16 },
  { header: 'Ordered On', width: 13 },
  { header: 'Refund Status', width: 14 },
  { header: 'Notes', width: 30 },
];

function addFailedItemsSheet(workbook: Workbook, input: RefundWorkbookInput): void {
  const sheet = workbook.addWorksheet('Items to Refund');
  layout(sheet, FAILED_COLUMNS);

  for (const r of input.refunds) {
    const row = sheet.addRow([
      r.shipName || r.customerName, r.shipPhone || r.customerPhone, r.customerEmail, r.userId,
      r.orderNo, r.orderItemId, input.batchLabel, r.productName,
      r.qty, r.unitPricePhp, r.lineTotalPhp,
      COLLECTED_BASIS_LABEL[r.collectedBasis],
      r.goodsPhp, r.depositPhp, r.amountPhp,
      r.kahatiVials, r.pasaloVials, r.combinedVials, r.minRequired,
      r.reason, r.paymentMethod ?? '', r.orderedOn,
      REFUND_STATUS_LABEL[r.status], r.notes ?? '',
    ]);
    tint(sheet, row.number, r.status === 'refunded' ? TINT_REFUNDED : TINT_PENDING, FAILED_COLUMNS.length);
  }
  sheet.getColumn(20).alignment = { wrapText: true, vertical: 'top' };

  totalsRow(sheet, [
    'TOTAL', null, null, null, null, null, null, null,
    input.refunds.reduce((s, r) => s + r.qty, 0),
    null, round(input.refunds.reduce((s, r) => s + r.lineTotalPhp, 0)), null,
    round(input.refunds.reduce((s, r) => s + r.goodsPhp, 0)),
    round(input.refunds.reduce((s, r) => s + r.depositPhp, 0)),
    round(input.refunds.reduce((s, r) => s + r.amountPhp, 0)),
    null, null, null, null, null, null, null, null, null,
  ]);
}

// ---- Sheet 3 -------------------------------------------------------------
// What these same customers are STILL getting. Its purpose is preventative:
// with only sheets 1 and 2 in front of them, an admin looking at a customer's
// total payment has no way to see that most of it bought something that ships,
// and refunding the lot is an easy, expensive mistake.
const SUCCESS_COLUMNS: Column[] = [
  { header: 'Customer Name', width: 26 },
  { header: 'Phone Number', width: 16 },
  { header: 'Email', width: 28 },
  { header: 'Order Number', width: 14 },
  { header: 'Order Item ID', width: 38 },
  { header: 'Batch', width: 18 },
  { header: 'Product', width: 34 },
  { header: 'Qty', width: 10, numFmt: INT_FORMAT },
  { header: 'Unit Price', width: 13, numFmt: PHP_FORMAT },
  { header: 'Amount', width: 14, numFmt: PHP_FORMAT },
  { header: 'Kahati Qty', width: 11, numFmt: INT_FORMAT },
  { header: 'Pasalo Qty', width: 11, numFmt: INT_FORMAT },
  { header: 'Final Combined Qty', width: 16, numFmt: INT_FORMAT },
  { header: 'Final Product Status', width: 18 },
  { header: 'Fulfilment Status', width: 18 },
  { header: 'Notes', width: 30 },
];

function addSuccessfulItemsSheet(workbook: Workbook, input: RefundWorkbookInput): void {
  const sheet = workbook.addWorksheet('Successful Items');
  layout(sheet, SUCCESS_COLUMNS);

  for (const s of input.successful) {
    const row = sheet.addRow([
      s.customerName, s.customerPhone, s.customerEmail, s.orderNo, s.orderItemId,
      input.batchLabel, s.productName, s.qty, s.unitPricePhp, s.lineTotalPhp,
      s.kahatiVials, s.pasaloVials, s.combinedVials,
      'SUCCESS', s.fulfilmentStatus,
      'Ships as normal — do not refund.',
    ]);
    tint(sheet, row.number, TINT_SUCCESS, SUCCESS_COLUMNS.length);
  }

  totalsRow(sheet, [
    'TOTAL', null, null, null, null, null, null,
    input.successful.reduce((s, r) => s + r.qty, 0), null,
    round(input.successful.reduce((s, r) => s + r.lineTotalPhp, 0)),
    null, null, null, null, null, null,
  ]);
}

// ---- Sheet 4 -------------------------------------------------------------
const BATCH_COLUMNS: Column[] = [
  { header: 'Product', width: 36 },
  { header: 'Kahati Qty', width: 11, numFmt: INT_FORMAT },
  { header: 'Pasalo Qty', width: 11, numFmt: INT_FORMAT },
  { header: 'Final Combined Qty', width: 16, numFmt: INT_FORMAT },
  { header: 'Payment-Confirmed Qty', width: 20, numFmt: INT_FORMAT },
  { header: 'Minimum Required', width: 16, numFmt: INT_FORMAT },
  { header: 'Maximum Qty', width: 13, numFmt: INT_FORMAT },
  { header: 'Needed to Qualify', width: 16, numFmt: INT_FORMAT },
  { header: 'Slots Remaining', width: 14, numFmt: INT_FORMAT },
  { header: 'Final Status', width: 14 },
  { header: 'Customers Affected', width: 17, numFmt: INT_FORMAT },
  { header: 'Total Successful Value', width: 19, numFmt: PHP_FORMAT },
  { header: 'Total Refund Value', width: 17, numFmt: PHP_FORMAT },
];

function addBatchSummarySheet(workbook: Workbook, input: RefundWorkbookInput): void {
  const sheet = workbook.addWorksheet('Batch Summary');
  layout(sheet, BATCH_COLUMNS);

  for (const b of input.batch) {
    const row = sheet.addRow([
      b.productName, b.kahatiVials, b.pasaloVials, b.combinedVials, b.paymentConfirmedVials,
      b.minRequired, b.maxVials, b.neededToQualify, b.slotsRemaining,
      b.outcome, b.customersAffected, b.successfulValuePhp, b.refundValuePhp,
    ]);
    tint(sheet, row.number, b.outcome === 'FAILED' ? TINT_FAILED : TINT_SUCCESS, BATCH_COLUMNS.length);
  }

  totalsRow(sheet, [
    `TOTAL · ${input.totals.products} products`,
    null, null, null, null, null, null, null, null,
    `${input.totals.successfulProducts} ok / ${input.totals.failedProducts} failed`,
    input.totals.customersRequiringRefund,
    input.totals.successfulValuePhp,
    input.totals.refundValuePhp,
  ]);

  // The one-line answer to "what happened to this batch", under the table where
  // somebody reading the sheet cold will actually find it.
  sheet.addRow([]);
  const note = sheet.addRow([
    `Batch: ${input.batchLabel} · generated ${input.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    + ` · ${input.totals.customersRequiringRefund} customer(s) to refund`,
  ]);
  note.font = { italic: true, color: { argb: 'FF6B7280' } };
  const disclaimer = sheet.addRow([
    'Refund Status is PENDING until an admin records the transfer in the dashboard.'
    + ' Downloading this file does not mark anything refunded.',
  ]);
  disclaimer.font = { italic: true, color: { argb: 'FF6B7280' } };
}

const round = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
