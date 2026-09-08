'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import { field, btnPrimary } from '@/components/admin-ui';
import { addDays, mostRecentFullWeekMonday } from '@/lib/report/week';
import { downloadWeeklyReportXlsx } from '@/lib/report/weekly-xlsx';
import { buildPackingList, openPackingListPrint } from '@/lib/report/packing-list';
import { REPORT_SEGMENTS, SEGMENT_LABEL, SEGMENT_SHORT_LABEL, type ReportSegment } from '@/lib/report/segment';
import { reportCycleLabel, type ReportCycle } from '@/lib/report/cycles';
import type { SegmentedWeeklyReport, WeeklyReport } from '@/lib/report/build';
import { SegmentReport } from './SegmentReport';
import { RefundExport } from './RefundExport';
import { PasaloRefundPanel } from './PasaloRefundPanel';

// Reports hub: pick any inclusive calendar range and read On-Hand, Group Buy,
// and Kahati independently. Each segment has its own rollups and workbook,
// so the batch order is never sized off stock that already shipped.
export default function AdminReportsPage() {
  const [initial] = useState(() => mostRecentFullWeekMonday(new Date()));
  const [from, setFrom] = useState(initial);
  const [to, setTo] = useState(() => addDays(initial, 6));
  const [busySegment, setBusySegment] = useState<ReportSegment | null>(null);
  // Which batch preset is showing. Cleared the moment either date is typed by
  // hand, so the picker can never claim a range the admin has since edited.
  const [cycleKey, setCycleKey] = useState('');
  const showToast = useToast((s) => s.show);

  // The batches themselves, dated by their own orders. A cycle opens at 22:00
  // Manila, so no From/To a person types reproduces one — picking it here is
  // what keeps the next batch's orders out of this batch's supplier sheet.
  const { data: cycleData } = useQuery({
    queryKey: ['admin', 'report', 'cycles'],
    queryFn: () => apiGet<{ cycles: ReportCycle[] }>('/admin/report/cycles'),
  });
  const cycles = cycleData?.cycles ?? [];

  const pickCycle = (key: string) => {
    setCycleKey(key);
    const cycle = cycles.find((c) => c.cycleKey === key);
    if (!cycle) return;
    setFrom(cycle.from);
    setTo(cycle.to);
  };

  // A hand-typed date is a custom range by definition, whatever the picker said.
  const typeFrom = (value: string) => { setCycleKey(''); setFrom(value); };
  const typeTo = (value: string) => { setCycleKey(''); setTo(value); };

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'report', 'range', from, to],
    queryFn: () => apiGet<{ from: string; to: string; report: WeeklyReport; segments: SegmentedWeeklyReport }>(
      `/admin/report/weekly${qs({ from, to })}`,
    ),
    enabled: !!from && !!to && to >= from,
  });
  const segments = data?.segments;

  const printPackingList = (segment: ReportSegment) => {
    const report = segments?.[segment];
    if (!report?.rows.length) { showToast(`No ${SEGMENT_LABEL[segment]} orders in that date range.`); return; }
    try {
      openPackingListPrint(buildPackingList(report), {
        title: SEGMENT_SHORT_LABEL[segment],
        rangeLabel: report.rangeLabel,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open the packing list.');
    }
  };

  const download = async (segment: ReportSegment) => {
    const report = segments?.[segment];
    if (!report?.rows.length) { showToast(`No ${SEGMENT_LABEL[segment]} orders in that date range.`); return; }
    setBusySegment(segment);
    try {
      // The end date goes with it: without it every workbook is named
      // "BBG-Week-<from>" whatever range was picked, and a batch sheet that
      // covers one week reads as one that covers any of them.
      await downloadWeeklyReportXlsx(report, from, segment, to);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not generate the report.');
    } finally {
      setBusySegment(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Reports</h1>
          <p className="mt-1 text-[13px] text-ink-muted">On-hand, Group Buy, and Kahati reported separately.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-semibold text-ink-muted">Batch
            <select aria-label="Report batch" className={`${field} mt-1 w-auto`} value={cycleKey}
              onChange={(e) => pickCycle(e.target.value)}>
              <option value="">Custom range</option>
              {cycles.map((cycle, index) => (
                <option key={cycle.cycleKey} value={cycle.cycleKey}>{reportCycleLabel(cycle, index)}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-ink-muted">From
            <input aria-label="Report start date" type="date" className={`${field} mt-1 w-auto`} value={from}
              onChange={(e) => typeFrom(e.target.value)} />
          </label>
          <label className="text-[11px] font-semibold text-ink-muted">To
            <input aria-label="Report end date" type="date" className={`${field} mt-1 w-auto`} min={from} value={to}
              onChange={(e) => typeTo(e.target.value)} />
          </label>
        </div>
      </div>

      {isLoading || !segments
        ? <div className="text-ink-muted">Loading report…</div>
        : REPORT_SEGMENTS.map((segment) => (
          <SegmentReport
            key={segment}
            segment={segment}
            report={segments[segment]}
            isBusy={busySegment === segment}
            onDownload={download}
            onPrintPackingList={printPackingList}
          />
        ))}

      {/* The Pasalo stage, above the supplier-shortfall export because it comes
          first in time: a batch is decided here, and only what could not be
          filled AFTER that is reconciled against the supplier's sheet below. */}
      <PasaloRefundPanel from={from} to={to} />

      {/* Sits under the segment reports because it answers the question that
          comes after them: the batch was ordered, it arrived short, now who is
          owed money. Shares the same date window — a refund belongs to one
          batch, and that batch is the range already chosen above. */}
      <RefundExport from={from} to={to} cycleKey={cycleKey} />
    </div>
  );
}
