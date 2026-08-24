'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiSend } from '@/lib/api-client';
import { field, label, btnPrimary } from '@/components/admin-ui';
import { php } from '@/lib/format';
import {
  DEFAULT_KAHATI_DOWNPAYMENT_POLICY, describeKahatiDownpayment,
  type KahatiDownpaymentPolicy, type KahatiDownpaymentMode,
} from '@/lib/kahati-downpayment';

const MODES: { value: KahatiDownpaymentMode; title: string; hint: string }[] = [
  { value: 'packing_fee', title: 'Packing fee only', hint: 'The original rule — a hatian collects this cycle’s packing fee and nothing else.' },
  { value: 'fixed', title: 'Fixed amount', hint: 'A flat peso deposit on every kahati order.' },
  { value: 'percent', title: 'Percentage', hint: 'A share of the order total (goods + packing fee).' },
];

/**
 * How much a customer is asked to send while their kit is still filling.
 *
 * Sits above the downpayment QR list rather than on the general Settings page,
 * because the amount and the QR are one decision: a QR that encodes ₱500 is
 * wrong the moment the policy says 20%. Keeping them on one screen is what makes
 * that visible to whoever changes either.
 */
export function KahatiDownpaymentCard() {
  const [policy, setPolicy] = useState<KahatiDownpaymentPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ kahatiDownpayment?: KahatiDownpaymentPolicy }>('/admin/settings')
      .then((d) => setPolicy(d.kahatiDownpayment ?? DEFAULT_KAHATI_DOWNPAYMENT_POLICY))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the downpayment policy.'));
  }, []);

  const patch = (over: Partial<KahatiDownpaymentPolicy>) => {
    setPolicy((p) => (p ? { ...p, ...over } : p));
    setDone(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!policy) return;
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      const d = await apiSend<{ kahatiDownpayment: KahatiDownpaymentPolicy }>(
        '/admin/settings', 'PATCH', { kahatiDownpayment: policy });
      setPolicy(d.kahatiDownpayment);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the downpayment policy.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[16px] bg-white p-5 shadow-card">
      <h3 className="m-0 font-display text-[15px] font-bold text-ink">Downpayment amount</h3>
      <p className="mb-4 mt-1 text-[12.5px] text-ink-muted">
        What a customer sends to hold a slot while the kit is still filling. The balance is
        collected later, at the final checkout, with this amount already deducted.
      </p>

      {!policy && !error && <p className="text-[13px] text-ink-muted">Loading…</p>}

      {policy && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {MODES.map((m) => {
              const active = policy.mode === m.value;
              return (
                <label key={m.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-[12px] border-[1.5px] px-3.5 py-3 transition-colors ${active ? 'border-brand-green bg-[#f2f8ec]' : 'border-line hover:border-[#a9c88f]'}`}>
                  <input type="radio" name="downpayment-mode" className="mt-1" checked={active}
                    onChange={() => patch({ mode: m.value })} />
                  <span>
                    <span className="block text-[13.5px] font-bold text-ink">{m.title}</span>
                    <span className="block text-[12px] text-ink-muted">{m.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {policy.mode === 'fixed' && (
            <div>
              <span className={label}>Downpayment amount ₱</span>
              <input type="number" min={1} step="1" required className={field}
                value={policy.amountPhp}
                onChange={(e) => patch({ amountPhp: Number(e.target.value) })} />
              <span className="mt-0.5 block text-[12px] text-ink-muted">
                Capped at the order total — a small order never pays more than it is worth.
              </span>
            </div>
          )}

          {policy.mode === 'percent' && (
            <div>
              <span className={label}>Downpayment percent %</span>
              <input type="number" min={1} max={100} step="1" required className={field}
                value={policy.percent}
                onChange={(e) => patch({ percent: Number(e.target.value) })} />
              <span className="mt-0.5 block text-[12px] text-ink-muted">
                Example: a ₱1,950 kahati order at {policy.percent || 0}% collects{' '}
                {php(Math.round(1950 * (policy.percent || 0)) / 100)} now.
              </span>
            </div>
          )}

          <label className="flex items-start gap-2 text-[13px] font-semibold text-ink-body">
            <input type="checkbox" className="mt-1" checked={policy.refundable}
              onChange={(e) => patch({ refundable: e.target.checked })} />
            <span>
              Refund the downpayment if the kahati is cancelled
              <span className="block text-[12px] font-normal text-ink-muted">
                Uncheck only if your terms say the deposit is forfeited. Shown to the customer at checkout.
              </span>
            </span>
          </label>

          <div>
            <span className={label}>Payment / refund instructions (optional)</span>
            <textarea className={`${field} h-[72px] resize-none`} maxLength={500}
              value={policy.policyNote ?? ''}
              placeholder="e.g. Downpayments are rolled over to your next hatian if a kit is cancelled."
              onChange={(e) => patch({ policyNote: e.target.value.trim() === '' ? null : e.target.value })} />
            <span className="mt-0.5 block text-[12px] text-ink-muted">
              Replaces the default refund line on the checkout screen and in the cancellation email.
            </span>
          </div>

          <p className="rounded-[10px] bg-surface-mist px-3 py-2 text-[12.5px] text-ink-body">
            Customers currently pay <strong>{describeKahatiDownpayment(policy)}</strong> when they join a kahati.
          </p>

          {done && <p className="rounded-[10px] bg-[#e8f5db] px-3 py-2 text-[13px] text-brand-greendark">Downpayment policy saved ✓</p>}
          {error && <p role="alert" className="rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}

          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : 'Save downpayment policy'}
          </button>
        </form>
      )}

      {error && !policy && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}
    </div>
  );
}
