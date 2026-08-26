'use client';
import { field } from '@/components/admin-ui';

type Props = {
  from: string;
  to: string;
  error: string | null;
  onChange: (next: { from: string; to: string }) => void;
};

/**
 * The dashboard's period picker: two native date inputs and a way out.
 *
 * Native inputs rather than a bespoke calendar — they carry the platform's own
 * picker, keyboard handling and locale, none of which is worth rebuilding for a
 * two-field filter. `min` on the end date makes a backwards range awkward to
 * pick; the message below still has to exist, because the field can be typed.
 */
export function DateRangeFilter({ from, to, error, onChange }: Props) {
  const isFiltered = Boolean(from || to);
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-semibold text-ink-muted">From
          <input aria-label="Dashboard start date" type="date" className={`${field} mt-1 w-auto`} value={from}
            onChange={(e) => onChange({ from: e.target.value, to })} />
        </label>
        <label className="text-[11px] font-semibold text-ink-muted">To
          <input aria-label="Dashboard end date" type="date" className={`${field} mt-1 w-auto`} min={from} value={to}
            onChange={(e) => onChange({ from, to: e.target.value })} />
        </label>
        {isFiltered && (
          <button
            type="button"
            onClick={() => onChange({ from: '', to: '' })}
            className="rounded-[10px] border border-line px-3 py-2 text-[13px] font-semibold text-ink-body transition-colors hover:border-brand-blue hover:text-brand-blue"
          >
            Clear
          </button>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-[12px] font-semibold text-warn-fg">{error}</p>}
    </div>
  );
}
