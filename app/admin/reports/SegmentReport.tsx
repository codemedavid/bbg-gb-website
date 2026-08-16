'use client';
import type { WeeklyReport } from '@/lib/report/build';
import { SEGMENT_LABEL, SEGMENT_SHORT_LABEL, type ReportSegment } from '@/lib/report/segment';
import { btnGhost, btnPrimary } from '@/components/admin-ui';
import { OrderSummaryReport } from './OrderSummaryReport';
import { ProductTotalsReport } from './ProductTotalsReport';

// One report segment — its orders, product rollup, and own download.
//
// The halves are separate rather than one filtered table because they answer
// separate questions: on-hand reports what left the shelf, group buy reports
// what is still owed to the supplier. Reading a kit count off a table that
// holds both over-orders every product sold on-hand that week.
type Props = {
  segment: ReportSegment;
  report: WeeklyReport;
  isBusy: boolean;
  onDownload: (segment: ReportSegment) => void;
  /** Opens the packing/address list for printing or saving as a PDF. */
  onPrintPackingList: (segment: ReportSegment) => void;
};

export function SegmentReport({ segment, report, isBusy, onDownload, onPrintPackingList }: Props) {
  const headingId = `segment-${segment}-heading`;
  const label = SEGMENT_LABEL[segment];
  const isEmpty = !report.rows.length;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft pb-3">
        <div>
          <h2 id={headingId} className="m-0 font-display text-[20px] font-bold">{label}</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {isEmpty
              ? 'No orders this week.'
              : `${report.orderCount} order${report.orderCount === 1 ? '' : 's'} · ${report.productTotals.rows.length} product${report.productTotals.rows.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Packing day works off addresses, not off a spreadsheet: this is the
              same range as one printable block per parcel, which the browser's
              print dialog saves as a PDF. */}
          <button
            className={`${btnGhost} whitespace-nowrap disabled:opacity-60`}
            onClick={() => onPrintPackingList(segment)}
            disabled={isEmpty}
          >
            🖨 Packing list PDF
          </button>
          <button
            className={`${btnPrimary} whitespace-nowrap`}
            onClick={() => onDownload(segment)}
            // A half with no orders produces an empty workbook, which reads as a
            // broken export rather than an empty week.
            disabled={isBusy || isEmpty}
          >
            {isBusy ? 'Preparing…' : `⬇ ${SEGMENT_SHORT_LABEL[segment]} Excel`}
          </button>
        </div>
      </div>

      <OrderSummaryReport report={report} />
      <ProductTotalsReport productTotals={report.productTotals} segment={segment} />
    </section>
  );
}
