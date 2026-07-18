'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { OverlayShell } from '@/components/OverlayShell';
import { BackHeader } from '@/components/headers';
import { OrderSummary, useOrderTotals } from '@/components/OrderSummary';
import { useCart } from '@/lib/store/cart';
import { useAuth } from '@/lib/useAuth';
import { useToast } from '@/lib/store/toast';
import { usePaymentMethods } from '@/lib/queries';
import { php } from '@/lib/format';

export default function CheckoutPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const items = useCart((s) => s.items);
  const clear = useCart((s) => s.clear);
  const { total, hasKahati, downpayment } = useOrderTotals();
  // Kahati carts pay only the reservation downpayment now; the balance is
  // collected after the kahati ends.
  const amountDueNow = hasKahati && downpayment > 0 ? downpayment : total;
  const toast = useToast((s) => s.show);
  const { data: methods = [] } = usePaymentMethods();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [methodId, setMethodId] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) { setName(user.name); setPhone(user.phone || ''); setAddress(user.address || ''); }
  }, [user]);

  // Default to the first method once loaded; keep valid if the list changes.
  useEffect(() => {
    if (methods.length && !methods.some((m) => m.id === methodId)) setMethodId(methods[0].id);
  }, [methods, methodId]);

  const selectedMethod = methods.find((m) => m.id === methodId) ?? null;

  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);

  const onProof = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setProof(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : '');
  };

  const place = async () => {
    if (!proof || !items.length || submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('items', JSON.stringify(items.map((i) => ({ kind: i.kind, refId: i.refId, qty: i.qty }))));
      fd.append('shipName', name);
      fd.append('shipPhone', phone);
      fd.append('shipAddress', address);
      if (selectedMethod) fd.append('paymentMethod', selectedMethod.label);
      fd.append('proof', proof);
      const res = await fetch('/api/orders', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not place order.');
      clear();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['groupbuys'] });
      router.replace(`/success/${json.data.orderNo}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not place order. Please try again.');
      setSubmitting(false);
    }
  };

  const methodChosen = methods.length === 0 || !!selectedMethod;
  const canPlace = !!proof && items.length > 0 && !!name && !!phone && !!address && methodChosen;

  return (
    <OverlayShell>
      <BackHeader title="Checkout" onBack={() => router.push('/cart')} />
      <div className="flex flex-col gap-3.5 p-4">
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
          <div className="mb-3 text-[13px] leading-relaxed text-ink-body">
            Choose a payment method, send your payment, then upload a screenshot of your proof of payment. We&apos;ll confirm your order once we receive it.
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
                {hasKahati && downpayment > 0 ? 'Downpayment due now' : 'Amount'}: <strong className="font-display text-ink-body">{php(amountDueNow)}</strong>
              </div>
              {selectedMethod.qrUrl && (
                <div className="mt-3 flex justify-center">
                  <img src={selectedMethod.qrUrl} alt={`${selectedMethod.label} QR code`} className="max-h-[260px] max-w-full rounded-xl" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-[14px] bg-white p-4 shadow-card">
          <div className="mb-2.5 text-[13px] font-bold text-ink">Proof of payment <span className="text-[#d33]">*</span></div>
          <label className="block cursor-pointer rounded-[12px] border-[1.5px] border-dashed border-[#a9c88f] bg-[#fbfdf9] p-[18px] text-center">
            <input type="file" accept="image/*,application/pdf" onChange={onProof} className="hidden" />
            {proof ? (
              <>
                {preview ? <img src={preview} alt="proof" className="mx-auto mb-2 max-h-[160px] max-w-full rounded-lg" /> : <div className="mb-1.5 text-2xl">📄</div>}
                <div className="text-[12.5px] font-bold text-brand-greendark">✓ Proof attached — tap to replace</div>
              </>
            ) : (
              <>
                <div className="mb-1.5 text-[26px]">🧾</div>
                <div className="text-[13.5px] font-bold text-ink">Upload payment proof</div>
                <div className="text-[12px] text-ink-muted">Screenshot or photo of your payment</div>
              </>
            )}
          </label>
        </div>

        <div className="rounded-[14px] bg-white p-4 shadow-card"><OrderSummary /></div>
        <div className="text-[11.5px] leading-relaxed text-ink-muted">
          🛬 Tip: white powder peptides ship first; salt forms, blends &amp; liquids arrive 3–5 days later — place them in separate orders to avoid delays.
        </div>
        <button onClick={place} disabled={!canPlace || submitting}
          className={`block w-full rounded-[12px] py-[15px] text-center text-[15px] font-bold text-white ${canPlace && !submitting ? 'bg-brand-green active:scale-[.99]' : 'bg-[#b9c6b4]'}`}>
          {submitting ? 'Placing…' : proof ? 'Place order' : 'Upload proof to place order'}
        </button>
      </div>
    </OverlayShell>
  );
}
