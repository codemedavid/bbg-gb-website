'use client';
import { php } from '@/lib/format';
import type { WeeklyReport } from '@/lib/report/build';

// On-page Order Summary: the same data the weekly Excel export carries, rendered
// as rollup tiles plus a per-order detail table for the admin to scan directly.
function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[14px] bg-white p-4 shadow-card">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 font-display text-[22px] font-bold" style={{ color: accent || '#1c2b26' }}>{value}</div>
    </div>
  );
}

export function OrderSummaryReport({ report }: { report: WeeklyReport }) {
  if (!report.rows.length) {
    return <div className="rounded-[14px] bg-white p-6 text-center text-[13px] text-ink-muted shadow-card">No orders in this period.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Orders" value={String(report.orderCount)} />
        <Tile label="Paid" value={String(report.counts.paid)} accent="#57a814" />
        <Tile label="Pending" value={String(report.counts.pending)} accent="#9a6b00" />
        <Tile label="Cancelled" value={String(report.counts.cancelled)} accent={report.counts.cancelled ? '#b23b3b' : '#1c2b26'} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Revenue (PHP)" value={php(report.totals.php)} accent="#0b46b8" />
        <Tile label="Revenue (USD)" value={`$${report.totals.usd.toFixed(2)}`} />
      </div>

      <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
        <table className="w-full min-w-[840px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-3">#</th><th className="px-3 py-3">Invoice</th><th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Customer</th><th className="px-3 py-3">Items</th><th className="px-3 py-3">Shipping</th>
              <th className="px-3 py-3">Payment</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.invoice} className="border-b border-line-soft/60 align-top">
                <td className="px-3 py-3 text-ink-muted">{r.index}</td>
                <td className="px-3 py-3 font-semibold text-ink">{r.invoice}</td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-body">{r.date}</td>
                <td className="px-3 py-3 text-ink-body">
                  <div className="font-semibold text-ink">{r.customer}</div>
                  <div className="text-[11px] text-ink-muted">{r.phone}</div>
                </td>
                <td className="px-3 py-3 text-ink-body">
                  {r.products.map((p, i) => <div key={i}>{p}</div>)}
                </td>
                <td className="px-3 py-3 text-ink-body">{r.courier}</td>
                <td className="px-3 py-3 text-ink-body">
                  <div>{r.payment}</div>
                  <div className="text-[11px] text-ink-muted">{r.paymentStatus}</div>
                </td>
                <td className="px-3 py-3 text-ink-body">{r.orderStatus}</td>
                <td className="px-3 py-3 text-right font-display font-bold text-ink">{php(r.php)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[#dff0d6] font-bold">
              <td className="px-3 py-3" colSpan={8}>Total ({report.orderCount} orders, {report.rangeLabel})</td>
              <td className="px-3 py-3 text-right font-display">{php(report.totals.php)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
