import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { OverlayShell } from '../components/OverlayShell';
import { BackHeader } from '../components/headers';
import { OrderSummary, useOrderTotals } from '../components/OrderSummary';
import { useCart } from '../store/cart';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { php } from '../lib/format';
import { useToast } from '../store/toast';

export function Checkout() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const items = useCart((s) => s.items);
  const clear = useCart((s) => s.clear);
  const { total } = useOrderTotals();
  const toast = useToast((s) => s.show);

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [address, setAddress] = useState(user?.address || '');
  const [proof, setProof] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      fd.append('proof', proof);
      const res = await api.post('/orders', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const orderNo = res.data.data.orderNo as string;
      clear();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['groupbuys'] });
      nav(`/success/${orderNo}`, { replace: true });
    } catch (err: any) {
      toast(err.response?.data?.error || 'Could not place order. Please try again.');
      setSubmitting(false);
    }
  };

  const canPlace = !!proof && items.length > 0 && name && phone && address;

  return (
    <OverlayShell>
      <BackHeader title="Checkout" onBack={() => nav('/cart')} />
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
          <div className="mb-2.5 text-[13px] font-bold text-ink">Pay via bank transfer</div>
          <div className="mb-3 rounded-[10px] bg-surface-mist px-3.5 py-3 text-[13px] leading-relaxed text-ink-body">
            <strong>BPI</strong> · Big Buyers Group Trading<br />
            Account No. <strong>8829-1044-77</strong><br />
            Amount: <strong className="font-display">{php(total)}</strong><br />
            <span className="text-[12px] text-ink-muted">Use your order name as reference.</span>
          </div>
          <label className="block cursor-pointer rounded-[12px] border-[1.5px] border-dashed border-[#a9c88f] bg-[#fbfdf9] p-[18px] text-center">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={onProof} className="hidden" />
            {proof ? (
              <>
                {preview
                  ? <img src={preview} alt="proof" className="mx-auto mb-2 max-h-[160px] max-w-full rounded-lg" />
                  : <div className="mb-1.5 text-2xl">📄</div>}
                <div className="text-[12.5px] font-bold text-brand-greendark">✓ Proof attached — tap to replace</div>
              </>
            ) : (
              <>
                <div className="mb-1.5 text-[26px]">🧾</div>
                <div className="text-[13.5px] font-bold text-ink">Upload payment proof</div>
                <div className="text-[12px] text-ink-muted">Screenshot or photo of your deposit slip</div>
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
