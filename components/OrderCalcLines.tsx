'use client';
import { php } from '@/lib/format';
import type { CalcLine } from '@/lib/order-calc';
import { StepCard } from './OrderCalcStep';

// Every control is named after its product. Two rows of identical −/+/✕ buttons
// are indistinguishable to a screen reader otherwise, and this list is exactly
// the place a customer is about to change a number they care about.
function LineRow({ line, onQty }: { line: CalcLine; onQty: (id: string, qty: number) => void }) {
  return (
    <li className="rounded-[12px] border border-line-soft bg-surface-mist p-3">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="break-words text-[13.5px] font-bold leading-tight text-ink">{line.name}</div>
          <div className="mt-0.5 text-[11.5px] text-ink-muted">
            {line.code && <strong className="font-bold tracking-wide text-brand-greendark">{line.code}</strong>}
            {line.code && ' · '}{php(line.unitPrice)} / vial
          </div>
        </div>
        <button onClick={() => onQty(line.id, 0)} aria-label={`Remove ${line.name}`}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-line text-[13px] text-ink-muted transition-colors hover:border-[#c2410c] hover:text-[#c2410c]">
          ✕
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        {/* 44px tap targets: this stepper is the only way to change a quantity
            on a phone, and the design sizes it accordingly. */}
        <div className="flex items-center overflow-hidden rounded-[10px] border border-line bg-white">
          <button onClick={() => onQty(line.id, line.qty - 1)} aria-label={`Decrease ${line.name}`}
            className="h-11 w-11 text-[19px] font-bold text-ink-body transition-colors hover:bg-surface-mist">−</button>
          <span className="min-w-[44px] text-center font-display text-[15px] font-bold text-ink">{line.qty}</span>
          <button onClick={() => onQty(line.id, line.qty + 1)} aria-label={`Increase ${line.name}`}
            className="h-11 w-11 text-[19px] font-bold text-ink-body transition-colors hover:bg-surface-mist">+</button>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-bold tracking-wider text-ink-muted">LINE TOTAL</span>
          <span className="whitespace-nowrap font-display text-[16px] font-bold text-brand-greendark">{php(line.lineTotal)}</span>
        </div>
      </div>
    </li>
  );
}

export function OrderCalcLines({ lines, onQty }: {
  lines: CalcLine[];
  onQty: (id: string, qty: number) => void;
}) {
  const vials = lines.reduce((sum, l) => sum + l.qty, 0);

  return (
    <StepCard step={2} title="Your order" aside={lines.length ? `${vials} ${vials === 1 ? 'vial' : 'vials'}` : undefined}>
      {lines.length === 0 ? (
        <div className="flex flex-col gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-[#a9c88f] px-4 py-6 text-center">
          <span aria-hidden className="text-[22px]">🧴</span>
          <span className="text-[13.5px] font-bold text-ink-body">No products yet</span>
          <span className="text-[12.5px] text-ink-muted">Search above and tap a product to add it here.</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {lines.map((l) => <LineRow key={l.id} line={l} onQty={onQty} />)}
        </ul>
      )}
    </StepCard>
  );
}
