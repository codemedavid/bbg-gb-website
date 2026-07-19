'use client';
import { useState } from 'react';
import type { GroupBuy } from '@/lib/types';
import { php } from '@/lib/format';
import { KAHATI_MIN_VIABLE_VIALS, isKahatiViable } from '@/lib/kahati';
import { useCart } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';

export function JoinSheet({ g, onClose }: { g: GroupBuy; onClose: () => void }) {
  const [qty, setQty] = useState(Math.min(g.remaining, Math.max(g.minVials, 1)));
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);

  const clamp = (n: number) => Math.min(g.remaining, Math.max(g.minVials, n));
  const confirm = () => {
    add({ key: `gb:${g.id}`, kind: 'group_buy', refId: g.id, name: `${g.name} — kahati`, spec: `Kahati · min ${g.minVials} vials`, unitPricePhp: g.perVialPhp, minQty: g.minVials, packingFeePhp: Number(g.repackFeePhp), qty });
    toast('Kahati claimed! Nasa cart na.');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-app animate-sheetup rounded-t-[20px] bg-white px-4 pb-[26px] pt-5 sm:animate-fadein sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-display text-[17px] font-bold text-ink">{g.name}</span>
          <button onClick={onClose} className="px-2 py-1 text-[20px] text-ink-muted">✕</button>
        </div>
        <div className="mb-2 text-[12.5px] text-ink-muted">
          {g.remaining} vials open · min {g.minVials} vials · {php(g.repackFeePhp)} packing fee, local shipping included
        </div>
        {/* The refund condition belongs where the customer actually commits money. */}
        <div className={`mb-4 rounded-[10px] px-3 py-2 text-[12px] leading-snug ${
          isKahatiViable(g.claimedSlots) ? 'bg-[#f2f8ec] text-brand-greendark' : 'bg-warn-softbg text-[#6b5a24]'}`}>
          {isKahatiViable(g.claimedSlots)
            ? `✓ This hatian already passed the ${KAHATI_MIN_VIABLE_VIALS}-vial minimum, so it is pushing through.`
            : `Needs ${KAHATI_MIN_VIABLE_VIALS - g.claimedSlots} more vial(s) to reach the ${KAHATI_MIN_VIABLE_VIALS}-vial minimum. If it falls short by the deadline the hatian is cancelled and your downpayment is refunded.`}
        </div>
        <div className="mb-4 flex items-center justify-between rounded-[14px] bg-surface-mist px-4 py-3.5">
          <div>
            <div className="text-[11px] text-ink-muted">Per vial</div>
            <strong className="font-display text-[20px] text-ink">{php(g.perVialPhp)}</strong>
          </div>
          <div className="flex items-center overflow-hidden rounded-[12px] border border-line bg-white">
            <button onClick={() => setQty((q) => clamp(q - 1))} className="flex h-11 w-[42px] items-center justify-center text-[18px] font-bold text-ink-body">−</button>
            <span className="w-[34px] text-center text-[16px] font-bold">{qty}</span>
            <button onClick={() => setQty((q) => clamp(q + 1))} className="flex h-11 w-[42px] items-center justify-center text-[18px] font-bold text-ink-body">+</button>
          </div>
        </div>
        <button onClick={confirm} className="block w-full rounded-[12px] bg-brand-green py-[15px] text-center text-[15px] font-bold text-white active:scale-[.99]">
          Commit {qty} vials · {php(g.perVialPhp * qty)}
        </button>
      </div>
    </div>
  );
}
