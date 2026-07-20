// Renders a WeeklyReport to a downloadable .xlsx workbook.
//
// Replaces the jsPDF export: the team works the weekly report in a spreadsheet —
// sorting by payment status, filtering unpaid buyers, summing columns — and a PDF
// cannot do any of that. Money is therefore written as real numbers with a
// currency format rather than pre-formatted strings.
//
// ExcelJS is dynamically imported by the download helper so its weight never
// lands in the initial admin bundle; buildWeeklyWorkbook takes the module as an
// argument-free import here only because tests need it synchronously.
import ExcelJS from 'exceljs';
import { REPORT_COLORS } from './constants';
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

const MONEY_FORMAT = '#,##0.00';

// ExcelJS wants 'FFRRGGBB'; REPORT_COLORS carries the PDF's [r,g,b] triples so
// both exports stay on one palette.
const argb = ([r, g, b]: [number, number, number]): string =>
  'FF' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();

export async function buildWeeklyWorkbook(
  report: WeeklyReport,
  mondayYmd: string,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BBG Peptides';
  const sheet = workbook.addWorksheet(`Week ${report.weekNo}`, {
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

  return workbook;
}

export function weeklyXlsxFilename(mondayYmd: string): string {
  return `${weekFilename(mondayYmd)}.xlsx`;
}

// Browser-side download. ExcelJS is imported here so the admin bundle only pays
// for it when someone actually exports.
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
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = weeklyXlsxFilename(mondayYmd);
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
