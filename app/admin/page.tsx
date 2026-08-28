'use client';
import { useState } from 'react';
import { useStats } from '@/lib/admin-api';
import { php } from '@/lib/format';
import { statsRangeError, type StatsRange } from '@/lib/analytics-range';
import { formatDateRange } from '@/lib/report/week';
import { StatCard } from './StatCard';
import { DateRangeFilter } from './DateRangeFilter';

// Card labels say only that a figure is scoped, never to what — the dates are
// long, and they are already stated once in the subtitle above the row.
const RANGE_LABEL = 'in range';

export default function DashboardPage() {
  const [picked, setPicked] = useState({ from: '', to: '' });
  // A half-filled pair is someone mid-entry, not a mistake worth shouting at.
  const rangeError = picked.from && picked.to ? statsRangeError(picked.from, picked.to) : null;
  const range: StatsRange | null = !rangeError && picked.from && picked.to ? picked : null;

  const { data, isLoading, error, refetch } = useStats(range);
  // A failed stats call has to say so. Falling through to the loading state
  // leaves the admin staring at "Loading dashboard…" with no way to tell a slow
  // request apart from a dead API, and no sign of what actually broke.
  if (error && !data) {
    return (
      <div role="alert" className="rounded-[16px] bg-white p-6 shadow-card">
        <div className="font-display text-[18px] font-bold text-ink">Could not load the dashboard</div>
        <p className="mt-1.5 text-[13px] text-ink-muted">{error instanceof Error ? error.message : 'The analytics request failed.'}</p>
        <button
          onClick={() => refetch()}
          className="mt-4 rounded-[10px] bg-brand-navy px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }
  if (isLoading || !data) return <div className="text-ink-muted">Loading dashboard…</div>;

  // The served range, not the picked one: while a new range is in flight the
  // cards must keep describing the numbers actually on screen.
  const served = data.range;
  const rangeTotals = served ? data.totals.range : undefined;
  const rangeFees = served ? data.packingFees.range : undefined;
  const rangeLabel = served ? formatDateRange(served.from, served.to) : '';

  const maxRev = Math.max(1, ...data.dailySummary.map((d) => d.revenue));
  const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short' });
  // A long range is a lot of bars; weekday initials stop being readable — or
  // meaningful, once the same weekday appears three times — well before then.
  const showDayLabels = data.dailySummary.length <= 14;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Dashboard</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {served ? `Performance for ${rangeLabel}.` : 'Weekly & monthly performance at a glance.'}
          </p>
        </div>
        <DateRangeFilter from={picked.from} to={picked.to} error={rangeError} onChange={setPicked} />
      </div>

      {/* Filtering drops the two standing period cards, leaving three tiles
          instead of five — and the revenue tile keeps its place and its label
          rather than yielding to a second one. A scoped figure appearing beside
          an unchanged 'Total revenue' is how the filter came to look broken:
          the number an admin watches has to be the number that moves. */}
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${rangeTotals ? 'xl:grid-cols-3' : 'xl:grid-cols-5'}`}>
        {!rangeTotals && (
          <>
            <StatCard label="Orders this week" value={String(data.totals.week.count)} sub={php(data.totals.week.revenue)} accent="#0b46b8" />
            <StatCard label="Orders this month" value={String(data.totals.month.count)} sub={php(data.totals.month.revenue)} accent="#57a814" />
          </>
        )}
        {/* The lifetime total is not dropped, it steps down to the sub line: the
            range is only readable against the whole. */}
        <StatCard
          label="Total revenue"
          value={php(rangeTotals ? rangeTotals.revenue : data.totals.all.revenue)}
          sub={rangeTotals
            ? `${rangeTotals.count} orders · ${php(data.totals.all.revenue)} all-time`
            : `${data.totals.all.count} orders all-time`}
          accent={rangeTotals ? '#57a814' : undefined}
        />
        {rangeFees !== undefined ? (
          <StatCard label={`Packing fees ${RANGE_LABEL}`} value={php(rangeFees)} sub={`${php(data.packingFees.all)} all-time`} accent="#0b46b8" />
        ) : (
          <StatCard
            label="Total packing fees"
            value={php(data.packingFees.all)}
            sub={`${php(data.packingFees.week)} this week · ${php(data.packingFees.month)} this month`}
            accent="#0b46b8"
          />
        )}
        <StatCard label="Pending proofs" value={String(data.pendingProofs)} sub="Awaiting verification" accent={data.pendingProofs ? '#9a6b00' : '#57a814'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[16px] bg-white p-5 shadow-card">
          <div className="mb-4 text-[14px] font-bold">{served ? 'Daily order summary' : 'Weekly order summary'}</div>
          {data.dailySummary.length ? (
            <div className="flex h-40 items-end gap-1.5">
              {data.dailySummary.map((d) => (
                <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  {showDayLabels && <div className="text-[11px] font-semibold text-ink-body">{d.count}</div>}
                  <div className="w-full rounded-t-md bg-gradient-to-t from-brand-blue to-brand-green" style={{ height: `${(d.revenue / maxRev) * 120 + 4}px` }} title={php(d.revenue)} />
                  {showDayLabels && <div className="text-[10.5px] text-ink-muted">{dayLabel(d.day)}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-[13px] text-ink-muted">
              {served ? 'No orders in the selected range.' : 'No orders in the last 7 days yet.'}
            </div>
          )}
        </div>

        <div className="rounded-[16px] bg-white p-5 shadow-card">
          <div className="mb-4 text-[14px] font-bold">🔥 Fast-moving items</div>
          {data.fastMoving.length ? (
            <div className="flex flex-col gap-2.5">
              {data.fastMoving.slice(0, 8).map((item, i) => (
                <div key={(item.productId || '') + i} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#e8f5db] text-[11px] font-bold text-brand-greendark">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{item.name}</span>
                  <span className="flex-none text-[13px] font-bold text-ink">{item.unitsSold} <span className="text-[11px] font-normal text-ink-muted">sold</span></span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-[13px] text-ink-muted">
              {served ? 'Nothing sold in the selected range.' : 'No sales recorded yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
