'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import { field, btnPrimary } from '@/components/admin-ui';
import { addDays, mostRecentFullWeekMonday } from '@/lib/report/week';
import { downloadWeeklyReportXlsx } from '@/lib/report/weekly-xlsx';
import { REPORT_SEGMENTS, SEGMENT_LABEL, type ReportSegment } from '@/lib/report/segment';
import type { SegmentedWeeklyReport, WeeklyReport } from '@/lib/report/build';
import { SegmentReport } from './SegmentReport';

// Reports hub: pick any inclusive calendar range and read On-Hand, Group Buy,
// and Kahati independently. Each segment has its own rollups and workbook,
// so the batch order is never sized off stock that already shipped.
export default function AdminReportsPage() {
  const [initial] = useState(() => mostRecentFullWeekMonday(new Date()));
  const [from, setFrom] = useState(initial);
  const [to, setTo] = useState(() => addDays(initial, 6));
  const [busySegment, setBusySegment] = useState<ReportSegment | null>(null);
  const showToast = useToast((s) => s.show);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'report', 'range', from, to],
    queryFn: () => apiGet<{ from: string; to: string; report: WeeklyReport; segments: SegmentedWeeklyReport }>(
      `/admin/report/weekly${qs({ from, to })}`,
    ),
    enabled: !!from && !!to && to >= from,
  });
  const segments = data?.segments;

  const download = async (segment: ReportSegment) => {
    const report = segments?.[segment];
    if (!report?.rows.length) { showToast(`No ${SEGMENT_LABEL[segment]} orders in that date range.`); return; }
    setBusySegment(segment);
    try {
      await downloadWeeklyReportXlsx(report, from, segment);
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
        <div className="flex items-end gap-2">
          <label className="text-[11px] font-semibold text-ink-muted">From
            <input aria-label="Report start date" type="date" className={`${field} mt-1 w-auto`} value={from}
              onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-[11px] font-semibold text-ink-muted">To
            <input aria-label="Report end date" type="date" className={`${field} mt-1 w-auto`} min={from} value={to}
              onChange={(e) => setTo(e.target.value)} />
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
          />
        ))}
    </div>
  );
}
