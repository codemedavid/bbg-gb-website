'use client';
import { useState } from 'react';
import { php } from '@/lib/format';
import { campaignCartLine, useCart } from '@/lib/store/cart';
import type { MoqCampaign } from '@/lib/types';

// Commit kits to a Group Buy (MOQ) campaign — by putting them in the cart.
//
// This sheet used to be a checkout of its own: it collected shipping details and
// a payment proof and posted straight to /api/campaigns/:id/commit. That made
// the group buy board the one place a customer could not fill a basket — one
// commitment, one payment, one packing fee, no chance to keep shopping. The
// commitment is now an ordinary cart line and the shared checkout takes the
// payment, which is also what lets several group buys share a single fee.

type Props = {
  c: MoqCampaign;
  onClose: () => void;
  onAdded: (c: MoqCampaign) => void;
};

export function CommitSheet({ c, onClose, onAdded }: Props) {
  // An admin-set per-customer minimum is the floor the cart line starts at.
  const minKits = Math.max(1, c.perCustomerMin ?? 1);
  const [qty, setQty] = useState(minKits);
  const add = useCart((s) => s.add);

  const unitPrice = Number(c.pricePerKitPhp);
  // A campaign has no per-customer cap: overshooting the MOQ is allowed, and a
  // commitment beyond the batch's room rolls into the successor it opens.
  const clamp = (n: number) => Math.max(minKits, n);

  const addToCart = () => {
    add({ ...campaignCartLine(c), qty });
    onAdded(c);
    onClose();
  };

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
        {/* No fee is quoted here — it is charged once at checkout, and only if
            this customer does not already have a parcel going in this group
            buy. Naming a figure the cart may then not charge is exactly the
            client/server disagreement the deferred-fee rules exist to avoid. */}
        <p className="mb-3 text-[12.5px] text-ink-muted">
          {c.committed} / {c.moq} kits committed · packing fee charged once at checkout
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

        {minKits > 1 && (
          <p className="mb-3 text-[12px] leading-snug text-ink-muted">
            This group buy asks for at least {minKits} kits per person.
          </p>
        )}

        <dl className="mb-3 flex flex-col gap-1 rounded-[12px] bg-surface-mist px-3.5 py-3 text-[12.5px]">
          <div className="flex justify-between text-ink-body">
            <dt>{qty} kit{qty === 1 ? '' : 's'} × {php(unitPrice)}</dt>
            <dd className="m-0">{php(unitPrice * qty)}</dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-line-soft pt-1.5 text-[14px] font-bold text-ink">
            <dt>Subtotal</dt>
            <dd className="m-0">{php(unitPrice * qty)}</dd>
          </div>
        </dl>

        <button onClick={addToCart}
          className="block w-full rounded-[12px] bg-brand-blue py-[15px] text-center text-[15px] font-bold text-white transition-colors active:scale-[.99]">
          Add to cart · {php(unitPrice * qty)}
        </button>
      </div>
    </div>
  );
}
