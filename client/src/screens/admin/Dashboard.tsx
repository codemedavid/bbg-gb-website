import { useStats } from './adminApi';
import { php } from '../../lib/format';

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-[16px] bg-white p-5 shadow-card">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1.5 font-display text-[28px] font-bold" style={{ color: accent || '#1c2b26' }}>{value}</div>
      {sub && <div className="mt-0.5 text-[12.5px] text-ink-muted">{sub}</div>}
    </div>
  );
}

export function Dashboard() {
  const { data, isLoading } = useStats();
  if (isLoading || !data) return <div className="text-ink-muted">Loading dashboard…</div>;

  const maxRev = Math.max(1, ...data.weeklySummary.map((d) => d.revenue));
  const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short' });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="m-0 font-display text-[24px] font-bold">Dashboard</h1>
        <p className="mt-1 text-[13px] text-ink-muted">Weekly &amp; monthly performance at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Orders this week" value={String(data.totals.week.count)} sub={php(data.totals.week.revenue)} accent="#0b46b8" />
        <StatCard label="Orders this month" value={String(data.totals.month.count)} sub={php(data.totals.month.revenue)} accent="#57a814" />
        <StatCard label="Total revenue" value={php(data.totals.all.revenue)} sub={`${data.totals.all.count} orders all-time`} />
        <StatCard label="Pending proofs" value={String(data.pendingProofs)} sub="Awaiting verification" accent={data.pendingProofs ? '#9a6b00' : '#57a814'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[16px] bg-white p-5 shadow-card">
          <div className="mb-4 text-[14px] font-bold">Weekly order summary</div>
          {data.weeklySummary.length ? (
            <div className="flex h-40 items-end gap-2">
              {data.weeklySummary.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="text-[11px] font-semibold text-ink-body">{d.count}</div>
                  <div className="w-full rounded-t-md bg-gradient-to-t from-brand-blue to-brand-green" style={{ height: `${(d.revenue / maxRev) * 120 + 4}px` }} title={php(d.revenue)} />
                  <div className="text-[10.5px] text-ink-muted">{dayLabel(d.day)}</div>
                </div>
              ))}
            </div>
          ) : <div className="py-10 text-center text-[13px] text-ink-muted">No orders in the last 7 days yet.</div>}
        </div>

        <div className="rounded-[16px] bg-white p-5 shadow-card">
          <div className="mb-4 text-[14px] font-bold">🔥 Fast-moving items</div>
          <div className="flex flex-col gap-2.5">
            {data.fastMoving.slice(0, 8).map((item, i) => (
              <div key={(item.productId || '') + i} className="flex items-center gap-3">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#e8f5db] text-[11px] font-bold text-brand-greendark">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{item.name}</span>
                <span className="flex-none text-[13px] font-bold text-ink">{item.unitsSold} <span className="text-[11px] font-normal text-ink-muted">sold</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
