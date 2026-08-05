'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import { field, btnPrimary } from '@/components/admin-ui';
import { recentWeekMondays, weekOptionLabel } from '@/lib/report/week';
import { downloadWeeklyReportXlsx } from '@/lib/report/weekly-xlsx';
import { REPORT_SEGMENTS, SEGMENT_LABEL, type ReportSegment } from '@/lib/report/segment';
import type { SegmentedWeeklyReport, WeeklyReport } from '@/lib/report/build';
import { SegmentReport } from './SegmentReport';

// Reports hub: pick a Mon–Sun week and read it as the two businesses it is —
// On-Hand (what left the shelf) and Group Buy / Kahati (what is owed to the
// supplier). Each half has its own rollups and downloads as its own workbook,
// so the batch order is never sized off stock that already shipped.
export default function AdminReportsPage() {
  const [weeks] = useState(() => recentWeekMondays(new Date()));
  const [monday, setMonday] = useState(weeks[0]);
  const [busySegment, setBusySegment] = useState<ReportSegment | null>(null);
  const showToast = useToast((s) => s.show);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'report', 'weekly', monday],
    queryFn: () => apiGet<{ monday: string; report: WeeklyReport; segments: SegmentedWeeklyReport }>(
      `/admin/report/weekly${qs({ week: monday })}`,
    ),
  });
  const segments = data?.segments;

  const download = async (segment: ReportSegment) => {
    const report = segments?.[segment];
    if (!report?.rows.length) { showToast(`No ${SEGMENT_LABEL[segment]} orders in that week.`); return; }
    setBusySegment(segment);
    try {
      await downloadWeeklyReportXlsx(report, monday, segment);
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
          <p className="mt-1 text-[13px] text-ink-muted">On-hand and group buy, reported separately.</p>
        </div>
        <select className={`${field} w-auto`} value={monday} onChange={(e) => setMonday(e.target.value)}>
          {weeks.map((w) => <option key={w} value={w}>{weekOptionLabel(w)}</option>)}
        </select>
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
