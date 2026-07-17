import type { ReactNode } from 'react';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg animate-fadein rounded-[16px] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
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

export function Labeled({ label: l, children }: { label: string; children: ReactNode }) {
  return <div><span className={label}>{l}</span>{children}</div>;
}
