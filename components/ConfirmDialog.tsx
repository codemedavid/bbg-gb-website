'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// A branded, accessible replacement for window.confirm() used by every
// destructive admin action (delete / archive / cancel). Mount ConfirmProvider
// once near the admin root, then call the promise-based useConfirm() hook at the
// call site: `if (!(await confirm({ ... }))) return;`.

type ConfirmTone = 'danger' | 'default';

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within a ConfirmProvider');
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  // The resolver lives in a ref so settling the promise never depends on stale
  // state captured by a render.
  const resolverRef = useRef<((result: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setOptions(opts);
      }),
    [],
  );

  const settle = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && <ConfirmDialog options={options} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

const TONE: Record<ConfirmTone, { icon: string; badge: string; confirm: string }> = {
  danger: {
    icon: '⚠️',
    badge: 'bg-[#fbe4e4] text-[#b23b3b]',
    confirm: 'bg-[#b23b3b] hover:bg-[#9a3232] focus-visible:ring-[#b23b3b]',
  },
  default: {
    icon: '❓',
    badge: 'bg-[#dbe8f5] text-brand-blue',
    confirm: 'bg-brand-green hover:bg-brand-greendark focus-visible:ring-brand-green',
  },
};

function ConfirmDialog({ options, onSettle }: { options: ConfirmOptions; onSettle: (result: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const tone = TONE[options.tone ?? 'danger'];

  // Escape cancels. Enter is deliberately NOT bound to confirm — a destructive
  // action should never fire from an accidental keypress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSettle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSettle]);

  // Default focus to Cancel so the safe choice is one Enter away.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
      onClick={() => onSettle(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={options.message ? 'confirm-message' : undefined}
        className="w-full max-w-[420px] animate-fadein rounded-[16px] bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className={`grid h-11 w-11 flex-none place-items-center rounded-full text-[20px] ${tone.badge}`} aria-hidden>
            {tone.icon}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="font-display text-[18px] font-bold text-ink">
              {options.title}
            </h2>
            {options.message && (
              <p id="confirm-message" className="mt-1.5 text-[13.5px] leading-relaxed text-ink-body">
                {options.message}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onSettle(false)}
            className="rounded-[10px] border border-line px-4 py-2.5 text-[14px] font-semibold text-ink-body outline-none hover:bg-surface-mist focus-visible:ring-2 focus-visible:ring-brand-navy/40"
          >
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => onSettle(true)}
            className={`rounded-[10px] px-4 py-2.5 text-[14px] font-bold text-white outline-none transition active:scale-[.98] focus-visible:ring-2 focus-visible:ring-offset-2 ${tone.confirm}`}
          >
            {options.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
