'use client';
// Admin → Cycle archives → one cycle.
//
// The hatian counters, group buy batches and orders of one cycle, as they
// stand. Orders open the same sheet as the orders board, so a refund or a
// status change is made in one place whichever screen it was found from.
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAdminCycle } from '@/lib/admin-api';
import { OrderDetail } from '@/app/admin/orders/OrderDetail';
import { STATUS_LABEL, STATUS_BADGE } from '@/lib/order-status';
import { php, shortDate } from '@/lib/format';
import { kahatiClaimedDisplay } from '@/lib/kahati';

const th = 'px-4 py-3';
const td = 'px-4 py-3';

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="m-0 font-display text-[16px] font-bold">{title} <span className="font-sans text-[13px] font-semibold text-ink-muted">({count})</span></h2>
      <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">{children}</div>
    </section>
  );
}

export default function AdminCyclePage() {
  const params = useParams<{ key: string }>();
  const key = params?.key ? decodeURIComponent(params.key) : null;
  const { data, isLoading, error } = useAdminCycle(key);
  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading) return <div className="text-ink-muted">Loading…</div>;
  if (error || !data) {
    return (
      <div className="rounded-[16px] bg-white p-8 text-center shadow-card">
        <div className="mb-1 font-bold text-ink">Nothing is filed under this cycle.</div>
        <Link href="/admin/cycles" className="text-[13px] font-semibold text-brand-blue hover:underline">← Cycle archives</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/cycles" className="text-[12.5px] font-semibold text-brand-blue hover:underline">← Cycle archives</Link>
        <h1 className="m-0 mt-1 font-display text-[24px] font-bold">
          {data.label}
          {data.current && <span className="ml-2 align-middle rounded bg-[#e8f5db] px-2 py-0.5 text-[11px] font-bold text-brand-greendark">current</span>}
        </h1>
      </div>

      <Section title="Hatian counters" count={data.kahatis.length}>
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr><th className={th}>Counter</th><th className={th}>Vials</th><th className={th}>Status</th></tr>
          </thead>
          <tbody>
            {data.kahatis.length ? data.kahatis.map((g) => (
              <tr key={g.id} className="border-b border-line-soft/60">
                <td className={`${td} font-semibold text-ink`}>{g.name}</td>
                <td className={`${td} text-ink-body`}>{kahatiClaimedDisplay(g.claimedSlots, g.totalSlots)}/{g.totalSlots}</td>
                <td className={td}><span className="rounded bg-line px-2 py-0.5 text-[11px] font-bold text-ink-body">{g.status}</span></td>
              </tr>
            )) : <tr><td className={`${td} text-ink-muted`} colSpan={3}>No hatian counter traded this cycle.</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section title="Group buy batches" count={data.campaigns.length}>
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr><th className={th}>Batch</th><th className={th}>Kits</th><th className={th}>Status</th></tr>
          </thead>
          <tbody>
            {data.campaigns.length ? data.campaigns.map((c) => (
              <tr key={c.id} className="border-b border-line-soft/60">
                <td className={`${td} font-semibold text-ink`}>{c.name} <span className="font-normal text-ink-muted">· batch #{c.batchNo}</span></td>
                <td className={`${td} text-ink-body`}>{c.committed}/{c.capacity}</td>
                <td className={td}><span className="rounded bg-line px-2 py-0.5 text-[11px] font-bold text-ink-body">{c.status}</span></td>
              </tr>
            )) : <tr><td className={`${td} text-ink-muted`} colSpan={3}>No group buy batch traded this cycle.</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section title="Orders" count={data.orders.length}>
        <table className="w-full min-w-[680px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr><th className={th}>Order</th><th className={th}>Customer</th><th className={th}>Type</th><th className={th}>Total</th><th className={th}>Status</th><th className={th}>Date</th></tr>
          </thead>
          <tbody>
            {data.orders.length ? data.orders.map((o) => (
              <tr key={o.id} onClick={() => setSelected(o.id)} className="cursor-pointer border-b border-line-soft/60 hover:bg-surface-mist">
                <td className={`${td} font-semibold text-ink`}>{o.orderNo}</td>
                <td className={`${td} text-ink-body`}>{o.shipName}<div className="text-[11px] text-ink-muted">{o.customerEmail}</div></td>
                <td className={td}><span className="rounded bg-surface-mist px-2 py-0.5 text-[11px] font-semibold text-ink-body">{o.buyType}</span></td>
                <td className={`${td} font-display font-bold`}>{php(o.totalPhp)}</td>
                <td className={td}><span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[o.status]}`}>{STATUS_LABEL[o.status]}</span></td>
                <td className={`${td} text-ink-muted`}>{shortDate(o.createdAt)}</td>
              </tr>
            )) : <tr><td className={`${td} text-ink-muted`} colSpan={6}>No order was placed this cycle.</td></tr>}
          </tbody>
        </table>
      </Section>

      {selected && <OrderDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
