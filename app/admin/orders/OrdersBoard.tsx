'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAdminOrders } from '@/lib/admin-api';
import { php, shortDate } from '@/lib/format';
import { STATUS_LABEL, STATUS_BADGE } from '@/lib/order-status';
import { SEGMENT_LABEL, type ReportSegment } from '@/lib/report/segment';
import { WeeklyReportButton } from './WeeklyReportButton';
import { OrderDetail } from './OrderDetail';

const FILTERS = [['', 'All'], ['proof_review', 'Proof review'], ['payment_confirmed', 'Confirmed'], ['batch_filling', 'Filling'], ['shipped', 'Shipped'], ['delivered', 'Delivered']] as const;

// The four boards, in the order they appear as tabs. `segment: undefined` is the
// unfiltered list, which stays at /admin/orders so every existing bookmark and
// the sidebar link still land somewhere useful.
const SEGMENT_TABS: readonly { href: string; label: string; segment?: ReportSegment }[] = [
  { href: '/admin/orders', label: 'All orders' },
  { href: '/admin/orders/on-hand', label: SEGMENT_LABEL.onhand, segment: 'onhand' },
  { href: '/admin/orders/group-buy', label: SEGMENT_LABEL.groupbuy, segment: 'groupbuy' },
  { href: '/admin/orders/kahati', label: SEGMENT_LABEL.kahati, segment: 'kahati' },
];

// What each board is for, said once at the top. On-hand asks "what leaves the
// shelf", kahati asks "who still owes a balance", group buy asks "what do we
// order from the supplier" — three jobs that used to share one table.
const SEGMENT_BLURB: Record<ReportSegment, string> = {
  onhand: 'Sold from stock on hand. Verify proofs, update status & add tracking.',
  groupbuy: 'Campaign and MOQ pre-orders waiting on the batch. Verify proofs, update status & add tracking.',
  kahati: 'Hatian commitments and their downpayments. Verify proofs, update status & add tracking.',
};

/**
 * The orders table, scoped to one segment or to all of them.
 *
 * Each segment is a route rather than another pill on the status row: they are
 * separate jobs, often done by separate people, and only a URL can be
 * bookmarked or handed over. The active tab arrives as a prop instead of being
 * read back off usePathname — the page that rendered it already knows.
 */
export function OrdersBoard({ segment }: { segment?: ReportSegment }) {
  const [filter, setFilter] = useState('');
  const { data: orders = [], isLoading } = useAdminOrders({ status: filter || undefined, segment });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">
            {segment ? `${SEGMENT_LABEL[segment]} Orders` : 'Orders'}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {segment ? SEGMENT_BLURB[segment] : 'Verify proofs, update status & add tracking.'}
          </p>
        </div>
        <WeeklyReportButton />
      </div>

      {/* Underlined tabs, not a second row of pills: the status row below is a
          filter on the open board, and two identical pill rows would read as one
          six-plus-four filter set. */}
      <nav aria-label="Order segments" className="-mb-1 flex gap-1 overflow-x-auto border-b border-line-soft">
        {SEGMENT_TABS.map((tab) => {
          const active = tab.segment === segment;
          return (
            <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                active ? 'border-brand-navy text-brand-navy' : 'border-transparent text-ink-muted hover:border-line hover:text-ink-body'}`}>
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([val, lbl]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${filter === val ? 'bg-brand-navy text-white' : 'bg-white text-ink-body'}`}>{lbl}</button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
        <table className="w-full min-w-[680px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr><th className="px-4 py-3">Order</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th></tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={6}>Loading…</td></tr> :
              orders.length ? orders.map((o) => (
                <tr key={o.id} onClick={() => setSelected(o.id)} className="cursor-pointer border-b border-line-soft/60 hover:bg-surface-mist">
                  <td className="px-4 py-3 font-semibold text-ink">{o.orderNo}</td>
                  <td className="px-4 py-3 text-ink-body">{o.shipName}<div className="text-[11px] text-ink-muted">{(o as any).customerEmail}</div></td>
                  <td className="px-4 py-3"><span className="rounded bg-surface-mist px-2 py-0.5 text-[11px] font-semibold text-ink-body">{o.buyType}</span></td>
                  <td className="px-4 py-3 font-display font-bold">{php(o.totalPhp)}</td>
                  <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[o.status]}`}>{STATUS_LABEL[o.status]}</span></td>
                  <td className="px-4 py-3 text-ink-muted">{shortDate(o.createdAt)}</td>
                </tr>
              )) : <tr><td className="px-4 py-6 text-ink-muted" colSpan={6}>
                No {segment ? `${SEGMENT_LABEL[segment].toLowerCase()} ` : ''}orders.
              </td></tr>}
          </tbody>
        </table>
      </div>
      {selected && <OrderDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
