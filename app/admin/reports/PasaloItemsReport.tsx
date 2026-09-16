'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from '@/lib/api-client';
import type { ReportCycle } from '@/lib/report/cycles';
import { formatDateRange } from '@/lib/report/week';
import { pasaloItemStatus, type PasaloItem } from '@/lib/report/pasalo-items';

export function PasaloItemsReport({ cycle }: { cycle?: ReportCycle }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'pasalo-items', cycle?.cycleKey],
    queryFn: () => apiGet<{ items: PasaloItem[] }>(`/admin/report/pasalo-items${qs(
      { cycleKey: cycle?.cycleKey },
    )}`),
    enabled: !!cycle,
  });
  const items = data?.items ?? [];
  const label = cycle ? `Selected batch · ${formatDateRange(cycle.from, cycle.to)}` : '';
  return (
    <section aria-labelledby="pasalo-items-title" className="rounded-[16px] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pasalo-items-title" className="m-0 font-display text-[18px] font-bold">Items for Pasalo / Bunuan</h2>
          <p className="text-[13px] text-ink-muted">{label || 'Select a batch above to see its items.'}</p>
          <p className="text-[13px] text-ink-muted">Pasalo / Bunuan: 7–9 committed vials of 10. Kits with 1–6 are cancelled when Pasalo opens.</p>
        </div>
        <p className="text-[13px] text-ink-muted">Download these details together with cart totals using “Kahati Cart + Pasalo Excel” in the Kahati section below.</p>
      </div>
      {isLoading && <p>Loading batch items…</p>}
      {isError && <p role="alert">Could not load the batch items. Please refresh to try again.</p>}
      {cycle && !isLoading && !isError && data && items.length === 0 && <p>No incomplete kits in this batch.</p>}
      {items.length > 0 && <>
        <p className="text-[12px] text-ink-muted">Counts are committed vials. Each row is one kit. Closed or cancelled counters need review before offering; these are historical commitments, not available checkout slots.</p>
        {(['Cancel', 'Pasalo'] as const).map(category => {
          const rows = items.filter(item => item.category === category);
          return <div key={category} className="mt-4">
            <h3 className="font-bold">{category === 'Cancel' ? 'Below minimum — cancel, do not offer' : 'Pasalo / Bunuan — complete the kit'} ({rows.length})</h3>
            {!rows.length ? <p className="text-[13px] text-ink-muted">No items in this group.</p> : <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-[13px]">
                <thead><tr>{['Product / kit', 'Committed', 'Minimum', 'Needed to qualify', 'Needed to complete kit', 'Stage'].map(h => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
                <tbody>{rows.map((item, index) => <tr key={item.id} className="border-t border-line-soft">
                  <td className="px-3 py-2"><strong>{item.name}</strong><div>{[item.code, item.spec].filter(Boolean).join(' · ')}</div><div className="text-ink-muted">Kit {index + 1} · {item.id.slice(0, 8)}</div></td>
                  <td className="px-3 py-2">{item.combinedVials}/{item.maxVials}</td>
                  <td className="px-3 py-2">{item.minRequired}</td>
                  <td className="px-3 py-2 font-bold">{item.neededToQualify}</td>
                  <td className="px-3 py-2 font-bold">{item.slotsRemaining}</td>
                  <td className="px-3 py-2">{pasaloItemStatus(item)}</td>
                </tr>)}</tbody>
              </table>
            </div>}
          </div>;
        })}
      </>}
    </section>
  );
}
