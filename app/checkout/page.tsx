'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { OverlayShell } from '@/components/OverlayShell';
import { BackHeader } from '@/components/headers';
import { OrderSummary, useOrderTotals } from '@/components/OrderSummary';
import { useCart } from '@/lib/store/cart';
import { useAuth } from '@/lib/useAuth';
import { useToast } from '@/lib/store/toast';
import { useKahatiCommitments, usePaymentMethods } from '@/lib/queries';
import { KahatiCommitmentsCard } from '@/components/KahatiCommitmentsCard';
import { ProofUploader } from '@/components/ProofUploader';
import { php } from '@/lib/format';
import { friendlyCheckoutError, staleCheckoutLine } from '@/lib/checkout-error';
import { SHIPPING_OPTIONS, DEFAULT_COURIER } from '@/lib/report/constants';

export default function CheckoutPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const items = useCart((s) => s.items);
  const note = useCart((s) => s.note);
  const clear = useCart((s) => s.clear);
  const removeLine = useCart((s) => s.remove);
  // The kahati commitments this customer already holds, and whether this
  // cycle's packing fee is already paid — one fee covers everything they join
  // between one opening and the next (see lib/packing-cycle.ts). Mirrors the
  // server rule that decides what is actually charged.
  const { data: kahatiHeld } = useKahatiCommitments();
  const paidThisCycle = !!kahatiHeld?.paidThisCycle;
  // A cart of nothing but hatian lines with the cycle fee already paid owes
  // nothing at all: no fee, and so no payment method, no proof, nothing to
  // review. Any on-hand or MOQ line alongside it is still paid for now.
  const confirmOnly = paidThisCycle && items.length > 0 && items.every((i) => i.kind === 'group_buy');

  // A hatian pays only the packing fee now; the goods are settled after it ends.
  const { hasKahati, dueNow } = useOrderTotals(paidThisCycle);
  const amountDueNow = dueNow;
  const toast = useToast((s) => s.show);
  const { data: methods = [] } = usePaymentMethods();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [methodId, setMethodId] = useState('');
  const [courier, setCourier] = useState<string>(DEFAULT_COURIER);
  // Several proofs, because a bank transfer cap turns one payment into two or
  // three. ProofUploader owns the previews and the remove buttons.
  const [proofs, setProofs] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Minted once per submission and reused on retries, so the server can
  // recognize a resubmitted checkout and replay the original orders instead of
  // creating duplicates. A fresh submission after success gets a fresh key.
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (user) { setName(user.name); setPhone(user.phone || ''); setAddress(user.address || ''); }
  }, [user]);

  // Default to the first method once loaded; keep valid if the list changes.
  useEffect(() => {
    if (methods.length && !methods.some((m) => m.id === methodId)) setMethodId(methods[0].id);
  }, [methods, methodId]);

  const selectedMethod = methods.find((m) => m.id === methodId) ?? null;

  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);

  const place = async () => {
    if ((proofs.length === 0 && !confirmOnly) || !items.length || submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('items', JSON.stringify(items.map((i) => ({ kind: i.kind, refId: i.refId, qty: i.qty, unit: i.unit }))));
      fd.append('shipName', name);
      fd.append('shipPhone', phone);
      fd.append('shipAddress', address);
      // Written in the cart, carried through here, saved onto every order this
      // checkout creates.
      if (note.trim()) fd.append('note', note.trim());
      if (selectedMethod && !confirmOnly) fd.append('paymentMethod', selectedMethod.label);
      fd.append('courier', courier);
      // Appended under one repeated field name; the route reads getAll('proof').
      for (const proof of proofs) fd.append('proof', proof);
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      fd.append('idempotencyKey', idempotencyKey.current);
      const res = await fetch('/api/orders', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        // A line the shop can no longer sell (delisted product, deleted or
        // closed hatian) would loop the same 400 on every retry — the cart is
        // persisted, so it never heals on its own. Drop the dead line, keep
        // the rest of the cart, and say so without exposing raw ids.
        const stale = res.status === 400 ? staleCheckoutLine(json.error ?? '') : null;
        const deadLine = stale && items.find((i) =>
          'refId' in stale ? i.refId === stale.refId : i.kind === 'group_buy' && i.name.startsWith(stale.kahatiName));
        if (deadLine) {
          removeLine(deadLine.key);
          toast(`"${deadLine.name}" is no longer available and was removed from your cart.`);
          setSubmitting(false);
          return;
        }
        // The upload-config 503 carries deploy jargon; friendlyCheckoutError
        // gives the customer a retryable message instead. Stock/validation
        // errors still show their own actionable text.
        toast(friendlyCheckoutError(res.status, json.error ?? ''));
        setSubmitting(false);
        return;
      }
      idempotencyKey.current = null; // this submission is done; the next one is new
      clear();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['groupbuys'] });
      // This checkout is itself a commitment, so the next one must not read a
      // cached "no commitments yet" and ask for a downpayment already covered —
      // nor quote a group buy packing fee this order has just paid.
      qc.invalidateQueries({ queryKey: ['kahati-commitments'] });
      qc.invalidateQueries({ queryKey: ['campaign-commitments'] });

      // A mixed cart becomes one order per mode. Carry the siblings through so
      // the success screen names every order, not just the first.
      const placed: string[] = (json.data.orders ?? []).map((o: { orderNo: string }) => o.orderNo);
      const [first = json.data.orderNo, ...rest] = placed;
      const more = rest.length ? `?more=${encodeURIComponent(rest.join(','))}` : '';
      router.replace(`/success/${first}${more}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not place order. Please try again.');
      setSubmitting(false);
    }
  };

  const methodChosen = confirmOnly || methods.length === 0 || !!selectedMethod;
  const canPlace = (proofs.length > 0 || confirmOnly) && items.length > 0 && !!name && !!phone && !!address && methodChosen;

  return (
    <OverlayShell>
      <BackHeader title="Checkout" onBack={() => router.push('/cart')} showHome />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3.5 p-4 lg:grid lg:max-w-none lg:grid-cols-[1fr_360px] lg:items-start lg:gap-5 lg:p-6">
        <div className="flex flex-col gap-3.5">
        <div className="rounded-[14px] bg-white p-4 shadow-card">
          <div className="mb-2.5 text-[13px] font-bold text-ink">Deliver to</div>
          <input name="shipName" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
            className="mb-2 w-full rounded-[10px] border-[1.5px] border-line px-3.5 py-2.5 text-[14px] outline-none focus:border-brand-green" />
          <input name="shipPhone" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number"
            className="mb-2 w-full rounded-[10px] border-[1.5px] border-line px-3.5 py-2.5 text-[14px] outline-none focus:border-brand-green" />
          <textarea name="shipAddress" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Complete delivery address"
            className="h-[60px] w-full resize-none rounded-[10px] border-[1.5px] border-line px-3.5 py-2.5 text-[14px] outline-none focus:border-brand-green" />
        </div>

        <div className="rounded-[14px] bg-white p-4 shadow-card">
          <div className="mb-2.5 text-[13px] font-bold text-ink">Shipping method</div>
          <div className="grid grid-cols-2 gap-2.5">
            {SHIPPING_OPTIONS.map((c) => {
              const active = c === courier;
              return (
                <button key={c} type="button" onClick={() => setCourier(c)}
                  className={`flex items-center justify-center gap-2 rounded-[12px] border-[1.5px] px-4 py-3.5 text-[15px] font-bold transition-colors ${active ? 'border-brand-green bg-[#f2f8ec] text-ink' : 'border-line bg-white text-ink-body hover:border-[#a9c88f]'}`}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {/* A commitment that owes nothing has no payment to choose, prove or
            review. What the customer needs instead is what they already hold —
            the running total this join is being added to. */}
        {confirmOnly ? (
          <KahatiCommitmentsCard summary={kahatiHeld!.summary} />
        ) : (
        <div className="rounded-[14px] bg-white p-4 shadow-card">
          <div className="mb-3 text-[13px] leading-relaxed text-ink-body">
            Choose a payment method, send your payment, then upload a screenshot of your proof of payment. Paid in several
            transfers? Attach one screenshot per transfer. We&apos;ll confirm your order once we receive it.
          </div>

          {methods.length === 0 ? (
            <div className="rounded-[10px] bg-surface-mist px-3.5 py-3 text-[13px] text-ink-muted">
              No payment methods are available right now. Please contact us to complete your payment.
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
              <div className="mt-1 text-[12px] text-ink-muted">
                {hasKahati && amountDueNow > 0 ? 'Packing fee due now' : 'Amount'}: <strong className="font-display text-ink-body">{php(amountDueNow)}</strong>
              </div>
              {selectedMethod.qrUrl && (
                <div className="mt-3 flex justify-center">
                  <img src={selectedMethod.qrUrl} alt={`${selectedMethod.label} QR code`} className="max-h-[260px] max-w-full rounded-xl" />
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {!confirmOnly && (
        <div className="rounded-[14px] bg-white p-4 shadow-card">
          <ProofUploader files={proofs} onChange={setProofs} />
        </div>
        )}
        </div>

        <div className="flex flex-col gap-3.5 lg:sticky lg:top-[72px]">
        {/* Read-only here. The cart owns the note; showing it back at the point
            of payment is what lets the customer confirm it survived the trip,
            and the link says where to change it. */}
        {note.trim() && (
          <div className="rounded-[14px] border border-line-soft bg-white p-4 shadow-card">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-[13px] font-bold text-ink">📝 Your note</span>
              <button type="button" onClick={() => router.push('/cart')}
                className="ml-auto text-[11.5px] font-semibold text-brand-blue underline">Edit</button>
            </div>
            <p className="m-0 whitespace-pre-wrap text-[12.5px] leading-snug text-ink-body">{note.trim()}</p>
          </div>
        )}
        <div className="rounded-[14px] bg-white p-4 shadow-card"><OrderSummary paidThisCycle={paidThisCycle} /></div>
        <div className="text-[11.5px] leading-relaxed text-ink-muted">
          🛬 Tip: white powder peptides ship first; salt forms, blends &amp; liquids arrive 3–5 days later — place them in separate orders to avoid delays.
        </div>
        <button onClick={place} disabled={!canPlace || submitting}
          className={`block w-full rounded-[12px] py-[15px] text-center text-[15px] font-bold text-white ${canPlace && !submitting ? 'bg-brand-green active:scale-[.99]' : 'bg-[#b9c6b4]'}`}>
          {submitting ? 'Placing…' : confirmOnly ? 'Confirm order' : proofs.length ? 'Place order' : 'Upload proof to place order'}
        </button>
        </div>
      </div>
    </OverlayShell>
  );
}
