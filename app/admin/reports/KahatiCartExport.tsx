'use client';
import { useState } from 'react';
import { btnPrimary } from '@/components/admin-ui';
import { useToast } from '@/lib/store/toast';
import type { WeeklyReport } from '@/lib/report/build';
import { downloadKahatiCartXlsx } from '@/lib/report/kahati-cart-xlsx';
import { apiGet, qs } from '@/lib/api-client';
import type { ReportCycle } from '@/lib/report/cycles';
import type { PasaloItem } from '@/lib/report/pasalo-items';

export function KahatiCartExport({ report, cycle }: { report: WeeklyReport; cycle?: ReportCycle }) {
  const [busy, setBusy] = useState(false);
  const showToast = useToast(s => s.show);
  const download = async () => {
    if (!report.kahatiCart || !cycle) return;
    setBusy(true);
    try {
      const { items } = await apiGet<{ items: PasaloItem[] }>(`/admin/report/pasalo-items${qs(
        { cycleKey: cycle.cycleKey },
      )}`);
      await downloadKahatiCartXlsx(report.kahatiCart, report.rangeLabel, items);
    }
    catch { showToast('Could not export the combined Kahati Cart / Pasalo workbook. Please try again.'); }
    finally { setBusy(false); }
  };
  return <button className={`${btnPrimary} whitespace-nowrap disabled:opacity-60`}
    disabled={busy || !report.kahatiCart || !cycle} onClick={download}
    title={!cycle ? 'Select a batch above to export Cart and Pasalo together.' : undefined}>
    {busy ? 'Preparing workbook…' : '⬇ Kahati Cart + Pasalo Excel'}
  </button>;
}
