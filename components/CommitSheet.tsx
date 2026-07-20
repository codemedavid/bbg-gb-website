'use client';
import { useEffect, useState } from 'react';
import { php } from '@/lib/format';
import { useAuth } from '@/lib/useAuth';
import type { MoqCampaign } from '@/lib/types';

// Commit kits to a Group Buy (MOQ) campaign.
//
// Unlike JoinSheet, this does not touch the cart. A campaign commitment posts
// straight to /api/campaigns/:id/commit with its own shipping details and payment
// proof, because the commitment *is* the order — the server holds it against the
// campaign's committed counter and refunds it if the MOQ never clears.

type Props = {
  c: MoqCampaign;
  onClose: () => void;
  onCommitted: (orderNo: string) => void;
};

export function CommitSheet({ c, onClose, onCommitted }: Props) {
  const { user } = useAuth();
  const [qty, setQty] = useState(c.perCustomerMin);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) { setName(user.name); setPhone(user.phone || ''); setAddress(user.address || ''); }
  }, [user]);

  const unitPrice = Number(c.pricePerKitPhp);
  const packingFee = Number(c.shippingPhp);
  const total = unitPrice * qty + packingFee;

  // The per-customer minimum is the floor; a campaign has no per-customer cap,
  // since overshooting the MOQ is allowed.
  const clamp = (n: number) => Math.max(c.perCustomerMin, n);

  const onProof = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setProof(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : '');
  };

  const submit = async () => {
    if (!proof || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('qty', String(qty));
      fd.append('shipName', name);
      fd.append('shipPhone', phone);
      fd.append('shipAddress', address);
      fd.append('proof', proof);
      const res = await fetch(`/api/campaigns/${c.id}/commit`, {
        method: 'POST', body: fd, credentials: 'include',
      });
      const json = await res.json();
      // Surface the campaign's own reason (cancelled, below per-customer min,
      // raced with an approve) instead of a generic failure.
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not commit to this group buy.');
      onCommitted(json.data.order.orderNo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not commit to this group buy.');
      setSubmitting(false);
    }
  };

  const canSubmit = !!proof && !!name && !!phone && !!address && !submitting;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Commit to ${c.name}`}
        className="max-h-[92vh] w-full max-w-app animate-sheetup overflow-y-auto rounded-t-[20px] bg-white px-4 pb-[26px] pt-5 sm:animate-fadein sm:rounded-[20px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="font-display text-[17px] font-bold text-ink">{c.name}</span>
          <button onClick={onClose} aria-label="Close" className="px-2 py-1 text-[20px] text-ink-muted">✕</button>
        </div>
        <p className="mb-3 text-[12.5px] text-ink-muted">
          {c.committed} / {c.moq} kits committed · min {c.perCustomerMin} kit{c.perCustomerMin === 1 ? '' : 's'} · {php(packingFee)} packing fee
        </p>

        <div className="mb-3 rounded-[10px] bg-warn-softbg px-3 py-2 text-[12px] leading-snug text-[#6b5a24]">
          Your payment is held against this group buy. If it never reaches {c.moq} kits and is cancelled, you are refunded in full.
        </div>

        <div className="mb-3 flex items-center justify-between rounded-[14px] bg-surface-mist px-4 py-3.5">
          <div>
            <div className="text-[11px] text-ink-muted">Per kit</div>
            <strong className="font-display text-[20px] text-ink">{php(unitPrice)}</strong>
          </div>
          <div className="flex items-center overflow-hidden rounded-[12px] border border-line bg-white">
            <button aria-label="Decrease kits" onClick={() => setQty((q) => clamp(q - 1))}
              className="flex h-11 w-[42px] items-center justify-center text-[18px] font-bold text-ink-body">−</button>
            <span data-testid="commit-qty" className="w-[34px] text-center text-[16px] font-bold">{qty}</span>
            <button aria-label="Increase kits" onClick={() => setQty((q) => clamp(q + 1))}
              className="flex h-11 w-[42px] items-center justify-center text-[18px] font-bold text-ink-body">+</button>
          </div>
        </div>

        <div className="mb-3 flex flex-col gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name"
            className="w-full rounded-[10px] border-[1.5px] border-line px-3.5 py-2.5 text-[14px] outline-none focus:border-brand-blue" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" autoComplete="tel"
            className="w-full rounded-[10px] border-[1.5px] border-line px-3.5 py-2.5 text-[14px] outline-none focus:border-brand-blue" />
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Complete delivery address" autoComplete="street-address"
            className="h-[60px] w-full resize-none rounded-[10px] border-[1.5px] border-line px-3.5 py-2.5 text-[14px] outline-none focus:border-brand-blue" />
        </div>

        {/* The buyer is being asked to send money before uploading proof, so the
            amount has to be visible before the upload step, not only on the button. */}
        <dl className="mb-3 flex flex-col gap-1 rounded-[12px] bg-surface-mist px-3.5 py-3 text-[12.5px]">
          <div className="flex justify-between text-ink-body">
            <dt>{qty} kit{qty === 1 ? '' : 's'} × {php(unitPrice)}</dt>
            <dd className="m-0">{php(unitPrice * qty)}</dd>
          </div>
          <div className="flex justify-between text-ink-body">
            <dt>Packing fee (local shipping incl.)</dt>
            <dd className="m-0">{php(packingFee)}</dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-line-soft pt-1.5 text-[14px] font-bold text-ink">
            <dt>Total to send now</dt>
            <dd className="m-0">{php(total)}</dd>
          </div>
        </dl>

        <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-[12px] border-[1.5px] border-dashed border-[#a9c88f] bg-[#fbfdf9] p-3">
          <input type="file" accept="image/*,application/pdf" onChange={onProof} className="hidden" />
          {preview
            ? <img src={preview} alt="proof" className="h-16 w-16 rounded-lg object-cover" />
            : <span className="grid h-16 w-16 place-items-center rounded-lg bg-surface-mist text-2xl">🧾</span>}
          <span className="text-[12.5px] font-semibold text-brand-greendark">
            {proof ? '✓ Proof attached — tap to replace' : 'Upload payment proof'}
          </span>
        </label>

        {error && <p role="alert" className="mb-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}

        <button onClick={submit} disabled={!canSubmit}
          className="block w-full rounded-[12px] bg-brand-blue py-[15px] text-center text-[15px] font-bold text-white transition-colors active:scale-[.99] disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-faint">
          {!proof
            ? 'Upload proof to commit'
            : submitting ? 'Committing…' : `Commit ${qty} kit${qty === 1 ? '' : 's'} · ${php(total)}`}
        </button>
      </div>
    </div>
  );
}
