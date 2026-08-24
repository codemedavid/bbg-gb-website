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
import { CheckoutItemsCard } from '@/components/CheckoutItemsCard';
import { ProofUploader } from '@/components/ProofUploader';
import { PaymentMethodPicker } from '@/components/PaymentMethodPicker';
import { php } from '@/lib/format';
import { refundNoticeFor } from '@/lib/kahati-downpayment';
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
  // A hatian pays a deposit now; the goods are settled once its kit completes.
  const { hasKahati, dueNow, downpayment, downpaymentPolicy, downpaymentIsDeposit, downpaymentPolicyLoaded } =
    useOrderTotals(paidThisCycle);

  // A cart of nothing but hatian lines with the cycle fee already paid owes
  // nothing at all: no fee, and so no payment method, no proof, nothing to
  // review. Any on-hand or MOQ line alongside it is still paid for now.
  //
  // Gated on the policy as well, and it has to be: a configured DEPOSIT is not a
  // per-cycle parcel charge, so the server keeps charging it on the second kit
  // (see the same rule in POST /api/orders). A screen that offered confirm-only
  // here would hide the payment card and the proof uploader from a checkout the
  // server then rejects for having no proof — a dead end the customer cannot
  // get out of.
  //
  // `downpaymentPolicyLoaded` is part of the condition because a FAILED settings
  // request looks exactly like "no deposit configured": both leave the fallback
  // packing-fee policy in hand. Skipping payment on that reading would hide the
  // payment card and the proof uploader from a checkout the server still charges
  // a deposit for — the same dead end, reached by a dropped request instead of a
  // missing gate.
  const confirmOnly = downpaymentPolicyLoaded && !downpaymentIsDeposit
    && paidThisCycle && items.length > 0 && items.every((i) => i.kind === 'group_buy');

  // …and the other reading of an unknown policy is no better. "Ask for payment"
  // cannot be acted on either, because the amount to ask for is the very thing
  // the policy decides: under the fallback, a settled cycle computes ₱0, so the
  // payment card — gated on an amount — never renders, while the proof uploader
  // does. The customer is left with an "upload proof of payment" box quoting no
  // amount, no account and no QR to make a proof against, and a Place button
  // that only unlocks once they attach an unrelated file.
  //
  // Neither reading is safe, so the screen commits to neither: while the policy
  // is unknown it says so and holds the order. Brief on a normal first paint,
  // and honest on a request that never lands.
  const awaitingDownpaymentPolicy = hasKahati && !downpaymentPolicyLoaded;
  const toast = useToast((s) => s.show);
  const { data: methods = [] } = usePaymentMethods();

  // The two obligations, split by what each method is FOR. A hatian kit that has
  // not filled yet collects a deposit against a QR of its own — often one that
  // encodes the exact amount — so the full-payment QR must not be reachable from
  // that screen at all. Filtering the list is what guarantees it: there is no
  // full-payment row to tap, not merely a rule saying do not tap it.
  const downpaymentMethods = methods.filter((m) => m.purpose === 'kahati_downpayment');
  const fullMethods = methods.filter((m) => m.purpose !== 'kahati_downpayment');

  // Whether this checkout is collecting a deposit rather than a full payment.
  // False under the historical packing-fee rule, which is a fee and pays through
  // the ordinary methods exactly as it always has.
  const collectingDownpayment = hasKahati && downpaymentIsDeposit && downpayment > 0;
  // Everything that is not a hatian line is still paid in full today.
  const fullAmountDue = Math.max(0, dueNow - (collectingDownpayment ? downpayment : 0));
  const needsFullPayment = !confirmOnly && fullAmountDue > 0;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [methodId, setMethodId] = useState('');
  // A separate selection, because the two lists are separate: a customer may pay
  // the deposit by GCash and the on-hand items by bank transfer.
  const [downpaymentMethodId, setDownpaymentMethodId] = useState('');
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

  // Default to the first method of each kind once loaded; keep valid if the list
  // changes. Kept apart so a downpayment method can never end up selected as the
  // full-payment one, or the other way round.
  useEffect(() => {
    if (fullMethods.length && !fullMethods.some((m) => m.id === methodId)) setMethodId(fullMethods[0].id);
  }, [fullMethods, methodId]);
  useEffect(() => {
    if (downpaymentMethods.length && !downpaymentMethods.some((m) => m.id === downpaymentMethodId)) {
      setDownpaymentMethodId(downpaymentMethods[0].id);
    }
  }, [downpaymentMethods, downpaymentMethodId]);

  const selectedMethod = fullMethods.find((m) => m.id === methodId) ?? null;
  const selectedDownpaymentMethod = downpaymentMethods.find((m) => m.id === downpaymentMethodId) ?? null;

  // A configured deposit with no QR to pay it into is the one state this screen
  // must refuse. Falling back to the full-payment QR would invite exactly the
  // full payment on an unfilled kit that this whole feature exists to prevent,
  // so checkout blocks and says so instead.
  const downpaymentUnavailable = collectingDownpayment && downpaymentMethods.length === 0;

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
      if (selectedMethod && needsFullPayment) fd.append('paymentMethod', selectedMethod.label);
      // Stamped onto the hatian orders this cart splits into, so the admin
      // reviewing the proof knows which account the deposit was sent to.
      if (selectedDownpaymentMethod && collectingDownpayment) {
        fd.append('downpaymentMethod', selectedDownpaymentMethod.label);
      }
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
      qc.invalidateQueries({ queryKey: ['campaigns'] });
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

  // Removing the last line here leaves nothing to ship, pay for or prove, so
  // the form comes off and the items card says so. `submitting` holds the
  // screen together through the moment a successful order clears the cart —
  // otherwise the customer gets an "empty cart" flash on the way to the receipt.
  const cartEmpty = items.length === 0 && !submitting;

  // Every obligation this checkout carries must have a method behind it.
  const methodChosen = confirmOnly
    || ((!needsFullPayment || fullMethods.length === 0 || !!selectedMethod)
      && (!collectingDownpayment || !!selectedDownpaymentMethod));
  const canPlace = (proofs.length > 0 || confirmOnly) && items.length > 0
    && !!name && !!phone && !!address && methodChosen && !downpaymentUnavailable
    // Placing under an unknown deposit rule would submit against a figure the
    // screen never quoted.
    && !awaitingDownpaymentPolicy;

  return (
    <OverlayShell>
      <BackHeader title="Checkout" onBack={() => router.push('/cart')} showHome />
      {cartEmpty ? (
        <div className="mx-auto w-full max-w-xl p-4"><CheckoutItemsCard /></div>
      ) : (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3.5 p-4 lg:grid lg:max-w-none lg:grid-cols-[1fr_360px] lg:items-start lg:gap-5 lg:p-6">
        <div className="flex flex-col gap-3.5">
        {/* First on the page, above the address: what you are buying is what a
            customer checks before they check anything else. */}
        <CheckoutItemsCard />
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

        {/* Nothing on this screen can be quoted until the deposit rule is
            known, so nothing is: no card, no QR, no proof box. */}
        {awaitingDownpaymentPolicy ? (
          <div role="status" className="rounded-[14px] bg-white p-4 text-[13px] leading-relaxed text-ink-body shadow-card">
            Getting the latest Kahati payment details… Please wait a moment before
            sending anything — the amount and the account to send it to depend on this.
          </div>
        ) : /* A commitment that owes nothing has no payment to choose, prove or
            review. What the customer needs instead is what they already hold —
            the running total this join is being added to. */
        confirmOnly ? (
          <KahatiCommitmentsCard summary={kahatiHeld!.summary} />
        ) : (
        <>
        {/* The hatian deposit gets a card of its own, above the full-payment one
            and visually distinct from it. The kit is still filling, so the ONLY
            QR reachable here is the downpayment QR — the full-payment list is a
            different card for a different, non-hatian obligation. */}
        {collectingDownpayment && (
          <section aria-labelledby="downpayment-heading" className="rounded-[14px] border-[1.5px] border-brand-green bg-white p-4 shadow-card">
            <h2 id="downpayment-heading" className="m-0 flex items-center gap-2 font-display text-[16px] font-bold text-brand-greendark">
              🔒 Downpayment Only
            </h2>
            <p className="mb-3 mt-1.5 text-[13px] leading-relaxed text-ink-body">
              Your Kahati kit is still waiting for other buyers. Please pay <strong>only the required
              downpayment of {php(downpayment)}</strong> using the QR code below — huwag munang bayaran ang buong
              order. We will request the remaining balance once the kit is complete and confirmed.
            </p>
            <p className="mb-3 rounded-[10px] bg-[#f2f8ec] px-3 py-2 text-[12px] leading-relaxed text-brand-greendark">
              {refundNoticeFor(downpaymentPolicy)}
            </p>
            {downpaymentUnavailable ? (
              <div role="alert" className="rounded-[10px] bg-[#fdeaea] px-3.5 py-3 text-[13px] text-[#a33]">
                The Kahati downpayment QR is not set up yet, so we cannot take a downpayment right now.
                Please message us before paying anything — do not send the full order amount.
              </div>
            ) : (
              <PaymentMethodPicker
                methods={downpaymentMethods}
                selectedId={downpaymentMethodId}
                onSelect={setDownpaymentMethodId}
                amount={downpayment}
                amountLabel="Send exactly this amount"
                emptyNotice="No Kahati downpayment method is available right now. Please contact us before paying."
              />
            )}
          </section>
        )}

        {needsFullPayment && (
        <div className="rounded-[14px] bg-white p-4 shadow-card">
          <div className="mb-3 text-[13px] leading-relaxed text-ink-body">
            {collectingDownpayment
              ? 'The rest of your cart is paid in full today. Choose a payment method for it, then upload your proof below.'
              : 'Choose a payment method, send your payment, then upload a screenshot of your proof of payment. Paid in several transfers? Attach one screenshot per transfer. We\u2019ll confirm your order once we receive it.'}
          </div>
          <PaymentMethodPicker
            methods={fullMethods}
            selectedId={methodId}
            onSelect={setMethodId}
            amount={fullAmountDue}
            amountLabel={hasKahati && !collectingDownpayment ? 'Packing fee due now' : 'Amount to send'}
            emptyNotice="No payment methods are available right now. Please contact us to complete your payment."
          />
        </div>
        )}
        </>
        )}

        {!confirmOnly && !awaitingDownpaymentPolicy && (
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
      )}
    </OverlayShell>
  );
}
