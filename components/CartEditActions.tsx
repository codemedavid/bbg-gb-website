'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/store/cart';

// The two escape hatches a customer needs while reviewing what they added:
// one more peptide, or start over. They sit side by side on both the cart and
// checkout, because a mistake spotted at the payment screen should not force a
// walk back to the cart to fix.
//
// Clearing confirms in place rather than through ConfirmProvider: that provider
// is mounted at the admin root only, and the storefront never has one above it.
// A second tap is still required — a cart assembled across four boards must not
// vanish on one stray press.
export function CartEditActions({ addLabel = 'Add more items' }: { addLabel?: string } = {}) {
  const router = useRouter();
  const clear = useCart((s) => s.clear);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex flex-col gap-2 rounded-[12px] border-[1.5px] border-[#e7c9c9] bg-[#fdf6f6] p-3">
        <p className="m-0 text-[12.5px] leading-snug text-[#8a3b3b]">
          Aalisin lahat ng nasa cart mo — pati ang note. Hindi na ito maibabalik.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirming(false)}
            className="flex-1 rounded-[10px] border border-line bg-white py-2.5 text-[13px] font-bold text-ink-body hover:bg-surface-mist">
            Keep my items
          </button>
          <button type="button" onClick={() => { clear(); setConfirming(false); }}
            className="flex-1 rounded-[10px] bg-[#b23b3b] py-2.5 text-[13px] font-bold text-white active:scale-[.99]">
            Yes, clear cart
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {/* Home, not router.back(): the boards are all one tap from there, and
          the cart survives the trip either way. */}
      <button type="button" onClick={() => router.push('/')}
        className="flex-1 rounded-[10px] border-[1.5px] border-brand-blue bg-white py-2.5 text-[13px] font-bold text-brand-blue transition-colors hover:bg-[#eef4fb]">
        ＋ {addLabel}
      </button>
      <button type="button" onClick={() => setConfirming(true)}
        className="rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-semibold text-ink-muted transition-colors hover:border-[#e0bcbc] hover:text-[#a33]">
        Clear cart
      </button>
    </div>
  );
}
