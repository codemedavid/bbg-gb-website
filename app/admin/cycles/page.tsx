'use client';
// Admin → Cycle archives.
//
// Every trading cycle the shop has run, newest first. A cycle turns and the
// boards and the orders screen go back to zero; this is where what they held
// went. Nothing is copied or deleted — each cycle is the same rows, read by the
// cycle they were stamped with, so a refund made on the orders screen shows
// here too.
import Link from 'next/link';
import { useAdminCycles } from '@/lib/admin-api';

const cycleHref = (key: string) => `/admin/cycles/${encodeURIComponent(key)}`;

export default function AdminCyclesPage() {
  const { data: cycles = [], isLoading } = useAdminCycles();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 font-display text-[24px] font-bold">Cycle Archives</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Every trading cycle, with the hatian counters, group buy batches and orders it took.
          The boards and the orders screen show the current cycle only.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3">Cycle</th>
              <th className="px-4 py-3">Orders</th>
              <th className="px-4 py-3">Hatian</th>
              <th className="px-4 py-3">Group Buy</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={4}>Loading…</td></tr> :
              cycles.length ? cycles.map((c) => (
                <tr key={c.cycleKey} className="border-b border-line-soft/60 hover:bg-surface-mist">
                  <td className="px-4 py-3 font-semibold text-ink">
                    <Link href={cycleHref(c.cycleKey)} className="hover:underline">{c.label}</Link>
                    {c.current && (
                      <span className="ml-2 rounded bg-[#e8f5db] px-2 py-0.5 text-[11px] font-bold text-brand-greendark">current</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-body">
                    {c.orders}{c.cancelledOrders > 0 && <span className="text-ink-muted"> · {c.cancelledOrders} cancelled</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-body">{c.kahatis} counter{c.kahatis === 1 ? '' : 's'} · {c.vials} vials</td>
                  <td className="px-4 py-3 text-ink-body">{c.campaigns} batch{c.campaigns === 1 ? '' : 'es'} · {c.kits} kits</td>
                </tr>
              )) : <tr><td className="px-4 py-6 text-ink-muted" colSpan={4}>No cycle has traded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
