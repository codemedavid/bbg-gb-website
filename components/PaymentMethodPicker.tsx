'use client';
import { php } from '@/lib/format';
import type { CheckoutPaymentMethod } from '@/lib/types';

/**
 * One payment obligation at checkout: pick a method, read the account details,
 * see the exact amount, scan the QR.
 *
 * Extracted because checkout now renders this TWICE for a mixed cart — a hatian
 * deposit and a full payment are different amounts against different QR codes,
 * and the hard requirement is that the two never blur together. Two instances of
 * one component, each handed its own filtered method list, is what makes
 * "the full-payment QR must not appear on the downpayment screen" structural
 * rather than a conditional someone has to keep correct.
 */
export function PaymentMethodPicker({
  methods, selectedId, onSelect, amount, amountLabel, emptyNotice,
}: {
  methods: CheckoutPaymentMethod[];
  selectedId: string;
  onSelect: (id: string) => void;
  amount: number;
  amountLabel: string;
  /** Shown in place of the list when no method of this kind is configured. */
  emptyNotice: string;
}) {
  const selected = methods.find((m) => m.id === selectedId) ?? null;

  if (methods.length === 0) {
    return (
      <div className="rounded-[10px] bg-surface-mist px-3.5 py-3 text-[13px] text-ink-muted">{emptyNotice}</div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {methods.map((m) => {
          const active = m.id === selectedId;
          return (
            <button key={m.id} type="button" onClick={() => onSelect(m.id)}
              className={`flex w-full items-center gap-3 rounded-[12px] border-[1.5px] px-4 py-3.5 text-left transition-colors ${active ? 'border-brand-green bg-[#f2f8ec]' : 'border-line bg-white hover:border-[#a9c88f]'}`}>
              <span className={`grid h-5 w-5 flex-none place-items-center rounded-full border-[1.5px] ${active ? 'border-brand-green' : 'border-line'}`}>
                {active && <span className="h-2.5 w-2.5 rounded-full bg-brand-green" />}
              </span>
              <span className="text-[15px] font-bold text-ink">{m.label}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mt-3 rounded-[12px] border border-line-soft bg-[#fbfdf9] p-4">
          <div className="text-[12px] text-ink-muted">Account name</div>
          <div className="mb-3 text-[16px] font-bold text-ink">{selected.accountName}</div>
          <div className="text-[12px] text-ink-muted">Account / number</div>
          <div className="text-[16px] font-bold text-ink">{selected.accountNumber}</div>
          {/* The amount sits with the QR rather than only in the summary: this is
              the number the customer types into their banking app. */}
          <div className="mt-2 rounded-[10px] bg-[#f2f8ec] px-3 py-2">
            <div className="text-[12px] text-brand-greendark">{amountLabel}</div>
            <div className="font-display text-[20px] font-bold text-brand-greendark">{php(amount)}</div>
          </div>
          {selected.instructions && (
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-body">{selected.instructions}</p>
          )}
          {selected.qrUrl && (
            <div className="mt-3 flex justify-center">
              <img src={selected.qrUrl} alt={`${selected.label} QR code`} className="max-h-[260px] max-w-full rounded-xl" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
