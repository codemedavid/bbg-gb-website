// Renders a WeeklyReport to a downloadable .xlsx workbook.
//
// Replaces the jsPDF export: the team works the weekly report in a spreadsheet —
// sorting by payment status, filtering unpaid buyers, summing columns — and a PDF
// cannot do any of that. Money is therefore written as real numbers with a
// currency format rather than pre-formatted strings.
//
// ExcelJS is loaded through a dynamic import so its ~22MB never lands in the
// initial admin bundle — WeeklyReportButton imports this module statically, so a
// top-level `import ExcelJS from 'exceljs'` here would be pulled into the admin
// page chunk on load. The type-only import erases at compile time and costs
// nothing. weekly-xlsx-download.test.ts pins both halves of that.
import type { Workbook, Worksheet } from 'exceljs';
import { REPORT_COLORS } from './constants';
import { weekFilename } from './week';
import type { WeeklyReport } from './build';

export const XLSX_HEADERS = [
  '#', 'Invoice', 'Date', 'Buyer Name', 'Contact Number', 'Email', 'Shipping Address',
  'Product Codes', 'Order Details', 'Courier', 'Packed By', 'Payment Method', 'Payment Status',
  'Order Status', 'USD', 'Packing Fee (PHP)', 'PHP',
] as const;

// Tuned so the wide free-text columns (address, order details) get room and the
// short codes do not waste it.
const COLUMN_WIDTHS = [5, 14, 12, 22, 16, 26, 34, 18, 38, 10, 12, 16, 15, 20, 11, 18, 13];

const MONEY_FORMAT = '#,##0.00';

// ExcelJS wants 'FFRRGGBB'; REPORT_COLORS carries the PDF's [r,g,b] triples so
// both exports stay on one palette.
const argb = ([r, g, b]: [number, number, number]): string =>
  'FF' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();

function subsetReport(report: WeeklyReport, buyType: 'group_buy' | 'kahati'): WeeklyReport {
  const rows = report.rows
    .filter((row) => row.buyType === buyType)
    .map((row, index) => ({ ...row, index: index + 1 }));
  const counts = rows.reduce((acc, row) => {
    if (row.orderStatus === 'Cancelled') acc.cancelled += 1;
    else if (row.paymentStatus === 'Paid') acc.paid += 1;
    else if (row.paymentStatus === 'Pending') acc.pending += 1;
    return acc;
  }, { paid: 0, pending: 0, cancelled: 0 });
  const totals = rows.reduce((acc, row) => {
    if (row.orderStatus !== 'Cancelled') {
      acc.usd += row.usd;
      acc.php += row.php;
      acc.packingFeePhp += row.packingFeePhp;
    }
    return acc;
  }, { usd: 0, php: 0, packingFeePhp: 0 });

  return { ...report, rows, orderCount: rows.length, counts, totals };
}

function addReportSheet(
  workbook: Workbook,
  report: WeeklyReport,
  sheetName: string,
  tableName: string,
): Worksheet {
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const orderRows = report.rows.map((row) => [
    row.index, row.invoice, row.date, row.customer, row.phone, row.email, row.address,
    row.productCodes.join('\n'),
    row.products.join('\n'),
    row.courier, row.packedBy, row.payment, row.paymentStatus, row.orderStatus,
    row.usd, row.packingFeePhp, row.php,
  ]);

  sheet.addTable({
    name: tableName,
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: XLSX_HEADERS.map((name) => ({ name, filterButton: true })),
    rows: orderRows,
  });

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: argb(REPORT_COLORS.headerText) } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.headerFill) } };
  headerRow.alignment = { vertical: 'middle', wrapText: true };

  const usdCol = XLSX_HEADERS.indexOf('USD') + 1;
  const packingFeeCol = XLSX_HEADERS.indexOf('Packing Fee (PHP)') + 1;
  const phpCol = XLSX_HEADERS.indexOf('PHP') + 1;
  const detailsCol = XLSX_HEADERS.indexOf('Order Details') + 1;
  const codesCol = XLSX_HEADERS.indexOf('Product Codes') + 1;
  const addressCol = XLSX_HEADERS.indexOf('Shipping Address') + 1;

  sheet.getColumn(usdCol).numFmt = MONEY_FORMAT;
  sheet.getColumn(packingFeeCol).numFmt = MONEY_FORMAT;
  sheet.getColumn(phpCol).numFmt = MONEY_FORMAT;
  for (const col of [codesCol, detailsCol, addressCol]) {
    sheet.getColumn(col).alignment = { wrapText: true, vertical: 'top' };
  }

  const totalRow = sheet.addRow([]);
  totalRow.getCell(1).value = 'TOTAL';
  totalRow.getCell(XLSX_HEADERS.indexOf('Order Status') + 1).value =
    `${report.orderCount} orders · ${report.counts.paid} paid · ${report.counts.pending} pending · ${report.counts.cancelled} cancelled`;
  totalRow.getCell(usdCol).value = report.totals.usd;
  totalRow.getCell(packingFeeCol).value = report.totals.packingFeePhp;
  totalRow.getCell(phpCol).value = report.totals.php;
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.totalFill) } };
  totalRow.getCell(usdCol).numFmt = MONEY_FORMAT;
  totalRow.getCell(packingFeeCol).numFmt = MONEY_FORMAT;
  totalRow.getCell(phpCol).numFmt = MONEY_FORMAT;

  return sheet;
}

export async function buildWeeklyWorkbook(
  report: WeeklyReport,
  mondayYmd: string,
): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BBG Peptides';
  // Named Excel Tables are stable PivotTable sources. The complete report is
  // preserved, while the two group-buy modes also get dedicated tabs and
  // independent totals. Custom totals stay outside each source table.
  addReportSheet(workbook, report, `Week ${report.weekNo}`, 'WeeklyOrders');
  addReportSheet(workbook, subsetReport(report, 'group_buy'), 'Group Buy', 'GroupBuyOrders');
  addReportSheet(workbook, subsetReport(report, 'kahati'), 'Kahati', 'KahatiOrders');

  return workbook;
}

export function weeklyXlsxFilename(mondayYmd: string): string {
  return `${weekFilename(mondayYmd)}.xlsx`;
}

// Browser-side download.
export async function downloadWeeklyReportXlsx(
  report: WeeklyReport,
  mondayYmd: string,
): Promise<void> {
  const workbook = await buildWeeklyWorkbook(report, mondayYmd);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);

  // The anchor has to be in the document for a synthetic click to register in
  // Firefox, and the object URL must outlive the click: browsers start the
  // download asynchronously, so revoking in the same tick invalidates the blob
  // before it is read and the file silently never arrives.
  const link = document.createElement('a');
  link.href = url;
  link.download = weeklyXlsxFilename(mondayYmd);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
