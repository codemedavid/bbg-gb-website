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
import { SEGMENT_SHORT_LABEL, type ReportSegment } from './segment';
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

// Second sheet: the same week rolled up per product, which is the shape the
// batch order is actually placed in. Column names match the sheet the team
// already circulates so nobody has to relearn the layout.
export const PRODUCT_TOTALS_SHEET = 'Product Totals';
export const PRODUCT_TOTALS_HEADERS = [
  '#', 'Product', 'Variant / Code', 'Specs', 'Total USD', 'Total Qty', 'Kits',
] as const;
const PRODUCT_COLUMN_WIDTHS = [5, 38, 16, 24, 13, 12, 10];

// The supplier-facing Group Buy workbook follows the Batch 6 sheet already
// used by the operations team. The two rightmost values remain in the file for
// calculations and auditing, but are hidden to reproduce that working view.
export const GROUP_BUY_PRODUCT_TOTALS_SHEET = 'BBG-ProductTotals';
export const GROUP_BUY_PRODUCT_TOTALS_HEADERS = [
  '#', 'Product', 'Variant / Code', 'Specs', 'Total Qty', 'Total USD',
] as const;
const GROUP_BUY_PRODUCT_COLUMN_WIDTHS = [11.75, 26.75, 10.875, 10.375, 9, 0, 0];

// Third sheet: the same range pivoted per buyer, which is the view packing day
// is worked from. Column names match the pivot the team already circulates
// ("Row Labels", "Sum of Quantity", "Sum of Amount") so the sheet reads as the
// one they know rather than as a new report to learn.
export const SUMMARY_SHEET = 'SUMMARY';
export const SUMMARY_HEADERS = ['Row Labels', 'Sum of Quantity', 'Sum of Amount'] as const;
const SUMMARY_COLUMN_WIDTHS = [34, 17, 17];
const GRAND_TOTAL_LABEL = 'Grand Total';

const MONEY_FORMAT = '#,##0.00';
const QTY_FORMAT = '#,##0.00';

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

  if (segment === 'groupbuy') {
    addGroupBuyProductTotalsSheet(workbook, report);
    // The supplier sheet says what to ORDER; the summary says who it is for and
    // what each of them owes. The team's own Batch 7 workbook carries both tabs,
    // and packing day needs the second one.
    addBuyerSummarySheet(workbook, report);
    return workbook;
  }

  const title = segment
    ? `${SEGMENT_SHORT_LABEL[segment]} · Week ${report.weekNo}`
    : `Week ${report.weekNo}`;
  const sheet = workbook.addWorksheet(title, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const rows = report.rows.map((row) => [
    row.index, row.invoice, row.date, row.customer, row.phone, row.email, row.address,
    row.productCodes.join('\n'), row.products.join('\n'),
    row.courier, row.packedBy, row.payment, row.paymentStatus, row.orderStatus,
    row.usd, row.packingFeePhp, row.php,
  ]);
  const tableName = segment === 'onhand'
    ? 'OnHandOrders'
    : segment === 'kahati' ? 'KahatiOrders' : 'WeeklyOrders';
  sheet.addTable({
    name: tableName,
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: XLSX_HEADERS.map((name) => ({ name, filterButton: true })),
    rows,
  });

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: argb(REPORT_COLORS.headerText) } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.headerFill) } };
  headerRow.alignment = { vertical: 'middle', wrapText: true };

  const usdCol = XLSX_HEADERS.indexOf('USD') + 1;
  const packingFeeCol = XLSX_HEADERS.indexOf('Packing Fee (PHP)') + 1;
  const phpCol = XLSX_HEADERS.indexOf('PHP') + 1;
  const codesCol = XLSX_HEADERS.indexOf('Product Codes') + 1;
  const detailsCol = XLSX_HEADERS.indexOf('Order Details') + 1;
  const addressCol = XLSX_HEADERS.indexOf('Shipping Address') + 1;

  sheet.getColumn(usdCol).numFmt = MONEY_FORMAT;
  sheet.getColumn(packingFeeCol).numFmt = MONEY_FORMAT;
  sheet.getColumn(phpCol).numFmt = MONEY_FORMAT;
  for (const col of [codesCol, detailsCol, addressCol]) {
    sheet.getColumn(col).alignment = { wrapText: true, vertical: 'top' };
  }

  // Totals mirror the report's own figures, which already exclude cancelled
  // orders — recomputing here would risk the two disagreeing.
  const totalRow = sheet.addRow([]);
  totalRow.getCell(1).value = 'TOTAL';
  totalRow.getCell(XLSX_HEADERS.indexOf('Order Status') + 1).value =
    `${report.orderCount} orders · ${report.counts.paid} paid · ${report.counts.pending} pending · ${report.counts.cancelled} cancelled · Packing fees: ₱${(report.totals.packingFee ?? 0).toFixed(2)}`;
  totalRow.getCell(usdCol).value = report.totals.usd;
  totalRow.getCell(packingFeeCol).value = report.totals.packingFee ?? 0;
  totalRow.getCell(phpCol).value = report.totals.php;
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.totalFill) } };
  totalRow.getCell(usdCol).numFmt = MONEY_FORMAT;
  totalRow.getCell(packingFeeCol).numFmt = MONEY_FORMAT;
  totalRow.getCell(phpCol).numFmt = MONEY_FORMAT;

  // Filters over the data range let the team slice by status without setup.
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: XLSX_HEADERS.length },
  };

  addProductTotalsSheet(workbook, report);
  addBuyerSummarySheet(workbook, report);

  return workbook;
}

/** Build the one-tab supplier workbook matching BBG-ProductTotals Batch 6. */
function addGroupBuyProductTotalsSheet(workbook: Workbook, report: WeeklyReport): void {
  const sheet = workbook.addWorksheet(GROUP_BUY_PRODUCT_TOTALS_SHEET, {
    views: [{ state: 'normal', activeCell: 'B2' }],
    pageSetup: {
      orientation: 'portrait',
      pageOrder: 'downThenOver',
      scale: 100,
      fitToWidth: 1,
      fitToHeight: 1,
    },
  });

  GROUP_BUY_PRODUCT_COLUMN_WIDTHS.forEach((width, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = width;
    column.hidden = i >= 5;
  });

  sheet.addRow([`# BBG Product Totals - Week ${report.weekNo} · ${report.rangeLabel}`]);
  sheet.addRow([`# Orders: ${report.orderCount}  Units: ${report.productTotals.totals.qty}`]);
  sheet.addRow([...GROUP_BUY_PRODUCT_TOTALS_HEADERS, null]);

  for (const row of report.productTotals.rows) {
    sheet.addRow([row.index, row.name, row.code, row.spec, row.kits, row.usd, row.qty]);
  }

  const totalRow = sheet.addRow([
    'TOTAL', null, null, null,
    report.productTotals.totals.qty,
    report.productTotals.totals.usd,
    report.productTotals.totals.qty,
  ]);

  const blackFill = {
    type: 'pattern' as const,
    pattern: 'solid' as const,
    fgColor: { argb: 'FF000000' },
  };
  const whiteBoldFont = {
    name: 'Aptos Narrow',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };
  const thinBorder = {
    left: { style: 'thin' as const, color: { argb: 'FF000000' } },
    right: { style: 'thin' as const, color: { argb: 'FF000000' } },
    top: { style: 'thin' as const, color: { argb: 'FF000000' } },
    bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
  };

  for (let rowNumber = 1; rowNumber <= totalRow.number; rowNumber++) {
    for (let columnNumber = 1; columnNumber <= 7; columnNumber++) {
      const cell = sheet.getRow(rowNumber).getCell(columnNumber);
      cell.fill = blackFill;
      cell.font = whiteBoldFont;
      if (rowNumber >= 3 && rowNumber < totalRow.number) cell.border = thinBorder;
    }
  }
}

// Appended after the order sheet so the workbook opens on the view the team
// already knows, with the batch-order view one tab away.
// The per-buyer pivot: one bold row per buyer carrying their totals, their
// products indented under it, and a Grand Total closing the sheet.
//
// Written as plain rows rather than as a real Excel PivotTable because ExcelJS
// cannot author one — and because a pivot would recompute from a source range
// the team would then have to keep intact. These figures already agree with the
// order sheet; freezing them is the point.
function addBuyerSummarySheet(workbook: Workbook, report: WeeklyReport): void {
  const sheet = workbook.addWorksheet(SUMMARY_SHEET, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = SUMMARY_HEADERS.map((header, i) => ({ header, width: SUMMARY_COLUMN_WIDTHS[i] }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: argb(REPORT_COLORS.headerText) } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.headerFill) } };
  headerRow.alignment = { vertical: 'middle', wrapText: true };

  for (const group of report.buyerSummary.groups) {
    const buyerRow = sheet.addRow([group.buyer, group.qty, group.amountPhp]);
    buyerRow.font = { bold: true };

    for (const line of group.lines) {
      // Indented rather than moved into a second column: a pivot's row labels
      // share one column, and keeping that shape is what lets the team collapse
      // and filter the sheet the way they already do.
      const lineRow = sheet.addRow([line.label, line.qty, line.amountPhp]);
      lineRow.getCell(1).alignment = { indent: 2 };
    }
  }

  const totalRow = sheet.addRow([
    GRAND_TOTAL_LABEL,
    report.buyerSummary.totals.qty,
    report.buyerSummary.totals.amountPhp,
  ]);
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.totalFill) } };

  sheet.getColumn(SUMMARY_HEADERS.indexOf('Sum of Quantity') + 1).numFmt = QTY_FORMAT;
  sheet.getColumn(SUMMARY_HEADERS.indexOf('Sum of Amount') + 1).numFmt = MONEY_FORMAT;
}

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
  toYmd?: string,
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
  link.download = toYmd && toYmd !== mondayYmd
    ? `BBG-${mondayYmd}-to-${toYmd}${segment ? `-${segment}` : ''}.xlsx`
    : weeklyXlsxFilename(mondayYmd, segment);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
