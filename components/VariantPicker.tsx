'use client';

// The dose dropdown a multi-strength peptide carries.
//
// A native <select> rather than a custom listbox, for the same reason
// BoardControls uses one: on a phone it opens the platform's own picker, which
// is already large enough to tap, already scrolls, and already works with a
// screen reader. A hand-rolled dropdown would have to re-earn all three.
//
// Out-of-stock options are shown DISABLED rather than removed. Dropping them
// makes a strength the shop genuinely carries look like one it has never heard
// of; disabled says "this exists, just not today".

export type VariantOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Appended to the label when the option cannot be chosen, e.g. "sold out". */
  note?: string;
};

type Props = {
  /** Names the control for assistive tech — the peptide, not "variant". */
  productName: string;
  options: readonly VariantOption[];
  value: string;
  onChange: (value: string) => void;
};

export function VariantPicker({ productName, options, value, onChange }: Props) {
  return (
    <select
      aria-label={`${productName} — choose a variant`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // h-9 keeps the control at a tappable height on a phone; w-full stops a
      // long spec from widening the card past its grid column.
      className="mt-1 h-9 w-full rounded-[9px] border-[1.5px] border-line bg-white px-2 text-[12px] font-semibold text-ink outline-none transition-colors focus:border-brand-green"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.disabled && o.note ? `${o.label} — ${o.note}` : o.label}
        </option>
      ))}
    </select>
  );
}
