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
import type { Workbook } from 'exceljs';
import { REPORT_COLORS } from './constants';
import { SEGMENT_SHEET_LABEL, type ReportSegment } from './segment';
import { weekFilename } from './week';
import type { WeeklyReport } from './build';

export const XLSX_HEADERS = [
  '#', 'Invoice', 'Date', 'Buyer Name', 'Contact Number', 'Email', 'Shipping Address',
  'Order Details', 'Courier', 'Packed By', 'Payment Method', 'Payment Status',
  'Order Status', 'USD', 'PHP',
] as const;

// Tuned so the wide free-text columns (address, order details) get room and the
// short codes do not waste it.
const COLUMN_WIDTHS = [5, 14, 12, 22, 16, 26, 34, 38, 10, 12, 16, 15, 20, 11, 13];

// Second sheet: the same week rolled up per product, which is the shape the
// batch order is actually placed in. Column names match the sheet the team
// already circulates so nobody has to relearn the layout.
export const PRODUCT_TOTALS_SHEET = 'Product Totals';
export const PRODUCT_TOTALS_HEADERS = [
  '#', 'Product', 'Variant / Code', 'Specs', 'Total USD', 'Total Qty', 'Kits',
] as const;
const PRODUCT_COLUMN_WIDTHS = [5, 38, 16, 24, 13, 12, 10];

const MONEY_FORMAT = '#,##0.00';

// ExcelJS wants 'FFRRGGBB'; REPORT_COLORS carries the PDF's [r,g,b] triples so
// both exports stay on one palette.
const argb = ([r, g, b]: [number, number, number]): string =>
  'FF' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * @param segment Which half of the week this workbook holds. On-hand and group
 *   buy download as two files, so the sheet says which one is open. Omitted for
 *   the combined whole-week workbook.
 */
export async function buildWeeklyWorkbook(
  report: WeeklyReport,
  mondayYmd: string,
  segment?: ReportSegment,
): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BBG Peptides';
  const title = segment
    ? `${SEGMENT_SHEET_LABEL[segment]} · Week ${report.weekNo}`
    : `Week ${report.weekNo}`;
  const sheet = workbook.addWorksheet(title, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = XLSX_HEADERS.map((header, i) => ({ header, width: COLUMN_WIDTHS[i] }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: argb(REPORT_COLORS.headerText) } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.headerFill) } };
  headerRow.alignment = { vertical: 'middle', wrapText: true };

  for (const row of report.rows) {
    sheet.addRow([
      row.index, row.invoice, row.date, row.customer, row.phone, row.email, row.address,
      // One line per item — the cell wraps, so a 4-line order stays readable.
      row.products.join('\n'),
      row.courier, row.packedBy, row.payment, row.paymentStatus, row.orderStatus,
      row.usd, row.php,
    ]);
  }

  const usdCol = XLSX_HEADERS.indexOf('USD') + 1;
  const phpCol = XLSX_HEADERS.indexOf('PHP') + 1;
  const detailsCol = XLSX_HEADERS.indexOf('Order Details') + 1;
  const addressCol = XLSX_HEADERS.indexOf('Shipping Address') + 1;

  sheet.getColumn(usdCol).numFmt = MONEY_FORMAT;
  sheet.getColumn(phpCol).numFmt = MONEY_FORMAT;
  for (const col of [detailsCol, addressCol]) {
    sheet.getColumn(col).alignment = { wrapText: true, vertical: 'top' };
  }

  // Totals mirror the report's own figures, which already exclude cancelled
  // orders — recomputing here would risk the two disagreeing.
  const totalRow = sheet.addRow([]);
  totalRow.getCell(1).value = 'TOTAL';
  totalRow.getCell(XLSX_HEADERS.indexOf('Order Status') + 1).value =
    `${report.orderCount} orders · ${report.counts.paid} paid · ${report.counts.pending} pending · ${report.counts.cancelled} cancelled`;
  totalRow.getCell(usdCol).value = report.totals.usd;
  totalRow.getCell(phpCol).value = report.totals.php;
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.totalFill) } };
  totalRow.getCell(usdCol).numFmt = MONEY_FORMAT;
  totalRow.getCell(phpCol).numFmt = MONEY_FORMAT;

  // Filters over the data range let the team slice by status without setup.
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: XLSX_HEADERS.length },
  };

  addProductTotalsSheet(workbook, report);

  return workbook;
}

// Appended after the order sheet so the workbook opens on the view the team
// already knows, with the batch-order view one tab away.
function addProductTotalsSheet(workbook: Workbook, report: WeeklyReport): void {
  const sheet = workbook.addWorksheet(PRODUCT_TOTALS_SHEET, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = PRODUCT_TOTALS_HEADERS.map((header, i) => ({
    header,
    width: PRODUCT_COLUMN_WIDTHS[i],
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: argb(REPORT_COLORS.headerText) } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.headerFill) } };
  headerRow.alignment = { vertical: 'middle', wrapText: true };

  for (const row of report.productTotals.rows) {
    sheet.addRow([row.index, row.name, row.code, row.spec, row.usd, row.qty, row.kits]);
  }

  const usdCol = PRODUCT_TOTALS_HEADERS.indexOf('Total USD') + 1;
  sheet.getColumn(usdCol).numFmt = MONEY_FORMAT;

  const totalRow = sheet.addRow([]);
  totalRow.getCell(1).value = 'TOTAL';
  totalRow.getCell(PRODUCT_TOTALS_HEADERS.indexOf('Product') + 1).value =
    `${report.productTotals.rows.length} products · ${report.orderCount} orders`;
  totalRow.getCell(usdCol).value = report.productTotals.totals.usd;
  totalRow.getCell(PRODUCT_TOTALS_HEADERS.indexOf('Total Qty') + 1).value = report.productTotals.totals.qty;
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.totalFill) } };
  totalRow.getCell(usdCol).numFmt = MONEY_FORMAT;

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: PRODUCT_TOTALS_HEADERS.length },
  };
}

// The segment suffix is not decoration: both halves of a week are downloaded
// into the same folder, and without it the second overwrites the first.
export function weeklyXlsxFilename(mondayYmd: string, segment?: ReportSegment): string {
  return `${weekFilename(mondayYmd)}${segment ? `-${segment}` : ''}.xlsx`;
}

// Browser-side download.
export async function downloadWeeklyReportXlsx(
  report: WeeklyReport,
  mondayYmd: string,
  segment?: ReportSegment,
): Promise<void> {
  const workbook = await buildWeeklyWorkbook(report, mondayYmd, segment);
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
  link.download = weeklyXlsxFilename(mondayYmd, segment);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
