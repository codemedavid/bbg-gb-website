'use client';
import { useState } from 'react';
import { apiGet, qs } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import { btnPrimary, field } from '@/components/admin-ui';
import { recentWeekMondays, weekOptionLabel } from '@/lib/report/week';
import { downloadWeeklyReportXlsx } from '@/lib/report/weekly-xlsx';
import type { WeeklyReport } from '@/lib/report/build';

// Toolbar control on the Orders page: pick a Mon–Sun week and download the
// weekly order report as a formatted .xlsx workbook.
export function WeeklyReportButton() {
  // Compute the recent-week options once so the list is stable across renders.
  const [weeks] = useState(() => recentWeekMondays(new Date()));
  const [monday, setMonday] = useState(weeks[0]);
  const [busy, setBusy] = useState(false);
  const showToast = useToast((s) => s.show);

  const download = async () => {
    setBusy(true);
    try {
      const { report } = await apiGet<{ monday: string; report: WeeklyReport }>(`/admin/report/weekly${qs({ week: monday })}`);
      if (!report.rows.length) {
        showToast('No orders in that week.');
        return;
      }
      await downloadWeeklyReportXlsx(report, monday);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not generate the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <select className={`${field} w-auto`} value={monday} onChange={(e) => setMonday(e.target.value)} disabled={busy}>
        {weeks.map((w) => <option key={w} value={w}>{weekOptionLabel(w)}</option>)}
      </select>
      <button className={btnPrimary} onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : '⬇ Weekly Excel'}
      </button>
    </div>
  );
}
