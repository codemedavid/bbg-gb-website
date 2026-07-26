'use client';
import { useState } from 'react';
import { useAdminSettlements, useMutate } from '@/lib/admin-api';
import { php, shortDate } from '@/lib/format';
import type { AdminSettlement } from '@/lib/types';

// Admin → Settlements: verify the hatian final checkouts.
//
// This is the only place a settlement moves to 'paid', and that flip is what
// turns the customer's balance and packing fee to Paid and sends their
// confirmation email. Without this screen a customer could pay, upload proof,
// and sit at "under review" forever.
const FILTERS = [['', 'All'], ['proof_review', 'Awaiting verification'], ['paid', 'Paid'], ['cancelled', 'Cancelled']] as const;

const STATUS_BADGE: Record<AdminSettlement['status'], string> = {
  proof_review: 'bg-[#fdf3d8] text-[#8a6d1f]',
  paid: 'bg-[#e8f5db] text-brand-greendark',
  cancelled: 'bg-line text-ink-body',
};
const STATUS_LABEL: Record<AdminSettlement['status'], string> = {
  proof_review: 'Awaiting verification',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export default function AdminSettlementsPage() {
  const [filter, setFilter] = useState('');
  const { data: settlements = [], isLoading } = useAdminSettlements(filter || undefined);
  const { setSettlementStatus } = useMutate();
  // A rejected update must show its reason rather than leaving the admin
  // wondering whether the button worked.
  const [error, setError] = useState<string | null>(null);

  const update = async (id: string, status: 'paid' | 'cancelled') => {
    setError(null);
    try {
      await setSettlementStatus.mutateAsync({ id, status });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the settlement.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 font-display text-[24px] font-bold">Final checkouts</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Verify hatian settlements. Confirming one marks the customer&apos;s balance
          <strong> and</strong> their single packing fee as paid.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([val, lbl]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${filter === val ? 'bg-brand-navy text-white' : 'bg-white text-ink-body'}`}>{lbl}</button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}

      <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Orders covered</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Packing fee</th>
              <th className="px-4 py-3">Total paid</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Sent</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={8}>Loading…</td></tr> :
              settlements.length ? settlements.map((s) => (
                <tr key={s.id} className="border-b border-line-soft/60">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{s.customerName}</div>
                    <div className="text-[11px] text-ink-muted">{s.customerEmail}</div>
                  </td>
                  <td data-testid={`order-count-${s.id}`} className="px-4 py-3 font-bold text-ink">{s.orderCount}</td>
                  <td className="px-4 py-3">{php(s.balancePhp)}</td>
                  {/* The whole point of the feature: one fee, however many orders. */}
                  <td className="px-4 py-3 font-semibold text-brand-greendark">{php(s.packingFeePhp)}</td>
                  <td className="px-4 py-3 font-display font-bold">{php(s.totalPhp)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                    {s.paidAt && <div className="mt-0.5 text-[11px] text-ink-muted">{shortDate(s.paidAt)}</div>}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{shortDate(s.createdAt)}</td>
                  <td className="px-4 py-3">
                    {s.status !== 'paid' && (
                      <div className="flex gap-2">
                        <button onClick={() => update(s.id, 'paid')} disabled={setSettlementStatus.isPending}
                          className="rounded-[9px] bg-brand-green px-3 py-1.5 text-[12.5px] font-bold text-white">
                          Confirm paid
                        </button>
                        {s.status !== 'cancelled' && (
                          <button onClick={() => update(s.id, 'cancelled')} disabled={setSettlementStatus.isPending}
                            className="rounded-[9px] border border-line px-3 py-1.5 text-[12.5px] font-semibold text-[#b23b3b]">
                            Reject
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )) : <tr><td className="px-4 py-6 text-ink-muted" colSpan={8}>No final checkouts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
