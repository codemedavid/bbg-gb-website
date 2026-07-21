'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import { field, btnPrimary } from '@/components/admin-ui';
import { recentWeekMondays, weekOptionLabel } from '@/lib/report/week';
import { downloadWeeklyReportXlsx } from '@/lib/report/weekly-xlsx';
import type { WeeklyReport } from '@/lib/report/build';
import { OrderSummaryReport } from './OrderSummaryReport';

// Reports hub: pick a Mon–Sun week, read the Order Summary on-page (detail rows
// + rollups) and download the same data as the formatted weekly .xlsx workbook.
export default function AdminReportsPage() {
  const [weeks] = useState(() => recentWeekMondays(new Date()));
  const [monday, setMonday] = useState(weeks[0]);
  const [busy, setBusy] = useState(false);
  const showToast = useToast((s) => s.show);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'report', 'weekly', monday],
    queryFn: () => apiGet<{ monday: string; report: WeeklyReport }>(`/admin/report/weekly${qs({ week: monday })}`),
  });
  const report = data?.report;

  const download = async () => {
    if (!report?.rows.length) { showToast('No orders in that week.'); return; }
    setBusy(true);
    try {
      await downloadWeeklyReportXlsx(report, monday);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not generate the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Reports</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Order Summary &amp; weekly export.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className={`${field} w-auto`} value={monday} onChange={(e) => setMonday(e.target.value)}>
            {weeks.map((w) => <option key={w} value={w}>{weekOptionLabel(w)}</option>)}
          </select>
          <button className={btnPrimary} onClick={download} disabled={busy || !report?.rows.length}>
            {busy ? 'Preparing…' : '⬇ Weekly Excel'}
          </button>
        </div>
      </div>

      {isLoading || !report
        ? <div className="text-ink-muted">Loading report…</div>
        : <OrderSummaryReport report={report} />}
    </div>
  );
}
