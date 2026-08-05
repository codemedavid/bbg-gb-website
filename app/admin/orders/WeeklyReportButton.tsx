'use client';
import { useState } from 'react';
import { apiGet, qs } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import { btnPrimary, field } from '@/components/admin-ui';
import { recentWeekMondays, weekOptionLabel } from '@/lib/report/week';
import { downloadWeeklyReportXlsx } from '@/lib/report/weekly-xlsx';
import { REPORT_SEGMENTS, SEGMENT_LABEL, SEGMENT_SHORT_LABEL, type ReportSegment } from '@/lib/report/segment';
import type { SegmentedWeeklyReport } from '@/lib/report/build';

// Toolbar control on the Orders page: pick a Mon–Sun week and download it as a
// formatted .xlsx workbook — one per half, since on-hand stock and the vials
// still owed to the supplier are ordered from separately.
//
// Two buttons rather than one that fires both downloads: a page that triggers a
// second programmatic download raises Chrome's "Download multiple files"
// prompt, and a blocked second file fails silently.
export function WeeklyReportButton() {
  // Compute the recent-week options once so the list is stable across renders.
  const [weeks] = useState(() => recentWeekMondays(new Date()));
  const [monday, setMonday] = useState(weeks[0]);
  const [busySegment, setBusySegment] = useState<ReportSegment | null>(null);
  const showToast = useToast((s) => s.show);

  const download = async (segment: ReportSegment) => {
    setBusySegment(segment);
    try {
      const { segments } = await apiGet<{ monday: string; segments: SegmentedWeeklyReport }>(
        `/admin/report/weekly${qs({ week: monday })}`,
      );
      const report = segments[segment];
      // An empty half exports a workbook holding nothing but headers, which
      // reads as a broken download rather than as a quiet week.
      if (!report.rows.length) {
        showToast(`No ${SEGMENT_LABEL[segment]} orders in that week.`);
        return;
      }
      await downloadWeeklyReportXlsx(report, monday, segment);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not generate the report.');
    } finally {
      setBusySegment(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <select
        className={`${field} w-auto`}
        value={monday}
        onChange={(e) => setMonday(e.target.value)}
        disabled={busySegment !== null}
      >
        {weeks.map((w) => <option key={w} value={w}>{weekOptionLabel(w)}</option>)}
      </select>
      {REPORT_SEGMENTS.map((segment) => (
        <button
          key={segment}
          // Without nowrap the two buttons compete for the toolbar's remaining
          // width and break mid-label ("On-" / "Hand").
          className={`${btnPrimary} whitespace-nowrap`}
          onClick={() => download(segment)}
          disabled={busySegment !== null}
        >
          {busySegment === segment ? 'Preparing…' : `⬇ ${SEGMENT_SHORT_LABEL[segment]}`}
        </button>
      ))}
    </div>
  );
}
