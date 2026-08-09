'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { SectionHeader } from '@/components/headers';
import { useSettlementPreview, usePaymentMethods } from '@/lib/queries';
import { useAuth } from '@/lib/useAuth';
import { useToast } from '@/lib/store/toast';
import { ProofUploader } from '@/components/ProofUploader';
import { php, shortDate } from '@/lib/format';

// Hatian final checkout.
//
// A customer joins as many hatians as they like paying only downpayments. This
// page is where all of it is settled at once: every completed hatian order's
// balance, plus ONE packing fee for the whole parcel. The single fee is the
// point of the screen, so it is stated in words as well as pesos — a customer
// who committed to four batches must be able to see they paid one fee, not four.
export default function SettlePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const { data: preview, isLoading } = useSettlementPreview(!!user);
  const { data: methods = [] } = usePaymentMethods();
  const toast = useToast((s) => s.show);

  const [methodId, setMethodId] = useState('');
  // Several proofs: a settlement clears every hatian's balance plus the packing
  // fee, so it is the largest amount a customer pays and the one a bank's
  // per-transfer cap most often splits.
  const [proofs, setProofs] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Minted once per submission and reused on retries, so a resubmitted final
  // checkout replays the original settlement rather than charging a second fee.
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);
  useEffect(() => {
    if (methods.length && !methods.some((m) => m.id === methodId)) setMethodId(methods[0].id);
  }, [methods, methodId]);

  const selectedMethod = methods.find((m) => m.id === methodId) ?? null;
  const orders = preview?.orders ?? [];
  const totals = preview?.totals ?? { balancePhp: 0, packingFeePhp: 0, totalPhp: 0 };

  const pay = async () => {
    if (proofs.length === 0 || !orders.length || submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      if (selectedMethod) fd.append('paymentMethod', selectedMethod.label);
      // Repeated field name; the route reads them with getAll('proof').
      for (const proof of proofs) fd.append('proof', proof);
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      fd.append('idempotencyKey', idempotencyKey.current);

      const res = await fetch('/api/settlements', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        toast(json.error || 'Could not send your final payment. Please try again.');
        setSubmitting(false);
        return;
      }
      idempotencyKey.current = null;
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['settlement-preview'] });
      toast('Final payment sent — we will confirm within 24 hours.');
      router.push('/orders');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send your final payment.');
      setSubmitting(false);
    }
  };

  if (isLoading || loading) {
    return (
      <>
        <SectionHeader title="💳 Final checkout" sub="Settle your completed hatian orders" />
        <div className="py-16 text-center text-[13px] text-ink-muted">Loading…</div>
      </>
    );
  }

  if (!orders.length) {
    return (
      <>
        <SectionHeader title="💳 Final checkout" sub="Settle your completed hatian orders" />
        <div className="px-5 py-16 text-center">
          <div className="mb-3 text-4xl">🫙</div>
          <div data-testid="settle-empty" className="mx-auto max-w-sm text-[13px] leading-relaxed text-ink-muted">
            Wala pa kang babayaran — none of your hatians has completed yet. Once a
            batch fills up or reaches its deadline, its balance shows up here and you
            settle everything in one payment with a single packing fee.
          </div>
        </div>
      </>
    );
  }

  // A settlement claims every ready order and marks them awaiting review, so it
  // must not be submittable when there is no method to have paid into — that
  // would file a payment nobody could have made.
  const canPay = proofs.length > 0 && orders.length > 0 && !!selectedMethod;

  return (
    <>
      <SectionHeader title="💳 Final checkout" sub="Settle your completed hatian orders" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3.5 p-4 md:p-6">

        <section className="rounded-[14px] bg-white p-4 shadow-card">
          <h2 className="m-0 mb-1 text-[13px] font-bold text-ink">Ready to settle</h2>
          <p className="mb-3 text-[12px] text-ink-muted">
            {orders.length} completed hatian order{orders.length === 1 ? '' : 's'} — isang packing fee lang para sa lahat.
          </p>
          {orders.map((o) => {
            const balance = Math.max(0, Number(o.totalPhp) - Number(o.downpaymentPhp));
            return (
              <div key={o.id} className="flex items-start justify-between border-b border-line-soft py-2.5 last:border-0">
                <div>
                  <div className="text-[13.5px] font-semibold text-ink">{o.orderNo}</div>
                  <div className="text-[11.5px] text-ink-muted">
                    {o.hatianNames.join(' · ')} — joined {shortDate(o.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13.5px] font-bold text-ink">{php(balance)}</div>
                  <div className="text-[11px] text-ink-muted">balance</div>
                </div>
              </div>
            );
          })}
        </section>

        <section className="rounded-[14px] bg-white p-4 shadow-card">
          <div className="mb-1.5 flex justify-between text-[13px] text-ink-body">
            <span>Balance ({orders.length} order{orders.length === 1 ? '' : 's'})</span>
            <span>{php(totals.balancePhp)}</span>
          </div>
          <div className="mb-1.5 flex justify-between text-[13px] text-ink-body">
            <span>Packing fee (once, local shipping incl.)</span>
            <span>{php(totals.packingFeePhp)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-line-soft pt-2.5 text-[16px] font-bold text-ink">
            <span>Total due</span><span className="font-display">{php(totals.totalPhp)}</span>
          </div>
        </section>

        <section className="rounded-[14px] bg-white p-4 shadow-card">
          <div className="mb-2.5 text-[13px] font-bold text-ink">Payment method</div>
          {methods.length === 0 ? (
            <div className="rounded-[10px] bg-surface-mist px-3.5 py-3 text-[13px] text-ink-muted">
              No payment methods are available right now. Please contact us to settle.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {methods.map((m) => {
                const active = m.id === methodId;
                return (
                  <button key={m.id} type="button" onClick={() => setMethodId(m.id)}
                    className={`flex w-full items-center gap-3 rounded-[12px] border-[1.5px] px-4 py-3.5 text-left transition-colors ${active ? 'border-brand-green bg-[#f2f8ec]' : 'border-line bg-white hover:border-[#a9c88f]'}`}>
                    <span className={`grid h-5 w-5 flex-none place-items-center rounded-full border-[1.5px] ${active ? 'border-brand-green' : 'border-line'}`}>
                      {active && <span className="h-2.5 w-2.5 rounded-full bg-brand-green" />}
                    </span>
                    <span className="text-[15px] font-bold text-ink">{m.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {selectedMethod && (
            <div className="mt-3 rounded-[12px] border border-line-soft bg-[#fbfdf9] p-4">
              <div className="text-[12px] text-ink-muted">Account name</div>
              <div className="mb-3 text-[16px] font-bold text-ink">{selectedMethod.accountName}</div>
              <div className="text-[12px] text-ink-muted">Account / number</div>
              <div className="text-[16px] font-bold text-ink">{selectedMethod.accountNumber}</div>
              {selectedMethod.qrUrl && (
                <div className="mt-3 flex justify-center">
                  <img src={selectedMethod.qrUrl} alt={`${selectedMethod.label} QR code`} className="max-h-[260px] max-w-full rounded-xl" />
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-[14px] bg-white p-4 shadow-card">
          <ProofUploader files={proofs} onChange={setProofs} />
        </section>

        <button onClick={pay} disabled={!canPay || submitting}
          className={`block w-full rounded-[12px] py-[15px] text-center text-[15px] font-bold text-white ${canPay && !submitting ? 'bg-brand-green active:scale-[.99]' : 'bg-[#b9c6b4]'}`}>
          {submitting ? 'Sending…' : proofs.length ? `Pay ${php(totals.totalPhp)}` : 'Upload proof to pay'}
        </button>
      </div>
    </>
  );
}
