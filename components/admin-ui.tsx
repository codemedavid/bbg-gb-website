'use client';
import type { ReactNode } from 'react';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* Named by its title so assistive tech — and a screen with two of these
          stacked, a campaign form and a product's quick edit — can tell which
          dialog is being read. */}
      <div role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-lg animate-fadein rounded-[16px] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="font-display text-[18px] font-bold text-ink">{title}</div>
          <button onClick={onClose} className="px-2 text-[20px] text-ink-muted">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const field = 'w-full rounded-[9px] border-[1.5px] border-line px-3 py-2 text-[14px] outline-none focus:border-brand-green';
export const label = 'mb-1 block text-[12px] font-semibold text-ink-body';
export const btnPrimary = 'rounded-[10px] bg-brand-green px-4 py-2.5 text-[14px] font-bold text-white active:scale-[.98] disabled:opacity-60';
export const btnGhost = 'rounded-[10px] border border-line px-4 py-2.5 text-[14px] font-semibold text-ink-body hover:bg-surface-mist';
// The board-level action that sits beside the primary button in a page header —
// "Start new cycle" on both the hatian and the campaigns board. Outlined rather
// than filled: it is consequential, but it is not the button the header is for.
export const btnBoardAction = 'rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] font-semibold text-brand-blue transition-colors hover:border-brand-blue disabled:opacity-50';

// A <label> wrapping its control, not a <div> beside one: the association is
// what lets a screen reader announce the field and a click on the caption focus
// it. Every admin form field goes through here, so getting it right once fixes
// all of them.
export function Labeled({ label: l, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className={label}>{l}</span>{children}</label>;
}
