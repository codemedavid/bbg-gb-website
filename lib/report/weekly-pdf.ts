// Renders a WeeklyReport to a downloadable landscape PDF matching the BioRhythm
// Weekly Order Report layout. jsPDF + autotable are dynamically imported so their
// weight never lands in the initial admin bundle — the import runs on click only.
import { REPORT_COLORS } from './constants';
import { weekFilename } from './week';
import type { WeeklyReport } from './build';

const REPORT_TITLE = 'BBG Weekly Order Report';

const HEAD = [
  '#', 'Invoice', 'Date', 'Customer', 'Contact/Email', 'Address', 'Products',
  'Shipping', 'Admin', 'Payment', 'Status', 'USD', 'PHP',
];

// Column widths (pt) tuned for A4 landscape with 40pt side margins (usable ≈ 762pt).
const COL_WIDTHS = [16, 58, 40, 60, 88, 104, 131, 34, 38, 44, 52, 40, 56];

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function manilaPrintedAt(now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);
}

export async function downloadWeeklyReportPdf(
  report: WeeklyReport,
  mondayYmd: string,
  now: Date = new Date(),
): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;

  const body = report.rows.map((r) => [
    String(r.index), r.invoice, r.date, r.customer, r.contact, r.address,
    r.products.join('\n'), r.courier, r.packedBy, r.payment, r.status,
    r.usd > 0 ? `$${money(r.usd)}` : '', money(r.php),
  ]);

  const foot = [[
    '', '', '', '', '', '', '', '', '', '', 'TOTAL',
    `$${money(report.totals.usd)}`, money(report.totals.php),
  ]];

  const columnStyles = Object.fromEntries(
    COL_WIDTHS.map((w, i) => [i, { cellWidth: w }]),
  ) as Record<number, { cellWidth: number }>;
  // Right-align the money columns (USD, PHP).
  columnStyles[11] = { ...columnStyles[11], halign: 'right' } as never;
  columnStyles[12] = { ...columnStyles[12], halign: 'right' } as never;

  autoTable(doc, {
    head: [HEAD],
    body,
    foot,
    startY: 92,
    margin: { left: marginX, right: marginX, top: 92 },
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak', valign: 'top', textColor: REPORT_COLORS.bodyText },
    headStyles: { fillColor: REPORT_COLORS.headerFill, textColor: REPORT_COLORS.headerText, fontSize: 7.5, fontStyle: 'bold', valign: 'middle' },
    footStyles: { fillColor: REPORT_COLORS.totalFill, textColor: REPORT_COLORS.bodyText, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: REPORT_COLORS.stripe },
    columnStyles,
    // Title + week subtitle band, redrawn on every page so multi-page reports
    // keep their header (matching the sample's per-page repeat).
    didDrawPage: () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(...REPORT_COLORS.title);
      doc.text(REPORT_TITLE, marginX, 42);

      const subtitle = `Week: Week ${report.weekNo} · ${report.rangeLabel} - ${report.orderCount} orders - Printed: ${manilaPrintedAt(now)}`;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...REPORT_COLORS.muted);
      doc.text(subtitle, marginX, 62);

      const { paid, pending, cancelled } = report.counts;
      const counts = `${paid} paid - ${pending} pending - ${cancelled} cancelled`;
      doc.text(counts, pageWidth - marginX, 62, { align: 'right' });
    },
  });

  doc.save(weekFilename(mondayYmd));
}
