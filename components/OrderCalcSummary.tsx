'use client';
import { useState } from 'react';
import { php } from '@/lib/format';
import type { OrderTotals } from '@/lib/order-calc';
import type { PackingMode } from '@/lib/pricing';

// The four ways to buy, in the words the storefront already uses for them.
// The fee follows the mode because BBG prices packing per mode — a single flat
// "shipping fee" would be right for at most one of these four.
const MODES: { mode: PackingMode; label: string }[] = [
  { mode: 'solo', label: 'On-hand' },
  { mode: 'kahati', label: 'Hatian' },
  { mode: 'group_buy', label: 'Pasabay' },
  { mode: 'moq', label: 'MOQ' },
];

export function OrderCalcSummary({ totals, mode, onMode }: {
  totals: OrderTotals;
  mode: PackingMode;
  onMode: (m: PackingMode) => void;
}) {
  // Collapsed by default, as designed: on a 320px screen an always-open
  // breakdown pushes the total itself off the bottom of the bar.
  const [open, setOpen] = useState(false);
  const hasItems = totals.vials > 0;

  return (
    // Sits above BottomNav (fixed, z-20, ~76px tall) rather than over it. The
    // page below reserves matching room so the last order line stays reachable.
    <div className="fixed bottom-[76px] left-1/2 z-[15] w-full max-w-app -translate-x-1/2 border-t border-line-mist bg-white px-4 pb-3 pt-2.5 shadow-sheet md:max-w-2xl md:px-6 lg:max-w-4xl">
      {open && (
        <div className="mb-2 flex flex-col gap-2 border-b border-line-soft pb-2.5">
          <div className="flex flex-wrap gap-1.5">
            {MODES.map((m) => (
              <button key={m.mode} onClick={() => onMode(m.mode)} aria-pressed={mode === m.mode}
                className={`rounded-full border px-3 py-[5px] text-[11.5px] font-bold transition-colors ${
                  mode === m.mode
                    ? 'border-brand-green bg-brand-green text-white'
                    : 'border-line bg-white text-ink-body hover:border-brand-green'}`}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[13px] text-ink-body">
            <span>Subtotal</span>
            <span className="font-bold text-ink">{php(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between text-[13px] text-ink-body">
            <span>Packing fee <span className="text-ink-muted">(incl. SF)</span></span>
            <span className="font-bold text-ink">{php(totals.fee)}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-muted">
            Estimate only. The final total may change based on availability, packing and price updates.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setOpen((v) => !v)}
          className="flex flex-col items-start py-0.5 text-left">
          <span className="text-[10px] font-bold tracking-wider text-ink-muted">
            ESTIMATED TOTAL {open ? '▾' : '▸'}
          </span>
          <span className="whitespace-nowrap font-display text-[21px] font-bold leading-tight text-ink">
            {php(totals.total)}
          </span>
        </button>
        <span className="text-right text-[11.5px] text-ink-muted">
          {hasItems ? 'Tap total for breakdown' : 'Add products to start'}
        </span>
      </div>
    </div>
  );
}
