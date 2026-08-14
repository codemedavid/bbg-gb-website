'use client';
import { BOARD_SORTS, type BoardSort } from '@/lib/board-filter';

// The search box and sort control both boards carry.
//
// One component rather than two, for the same reason lib/board-filter.ts is one
// module: a customer moving between the Kahati and Group Buy tabs should find
// the same control in the same place doing the same thing.

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  sort: BoardSort;
  onSortChange: (s: BoardSort) => void;
  /** Placeholder text — each board names what it actually holds. */
  placeholder: string;
  /** Label for the progress option; the boards count different things. */
  progressLabel: string;
  /** Rows currently shown, announced to screen readers as the search narrows. */
  resultCount: number;
};

export function BoardControls({
  query, onQueryChange, sort, onSortChange, placeholder, progressLabel, resultCount,
}: Props) {
  return (
    <div className="mb-3.5 flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">🔍</span>
        <input
          type="search"
          name="board-search"
          aria-label={placeholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-[10px] border-[1.5px] border-line bg-surface-field py-2.5 pl-9 pr-3.5 text-[14px] outline-none transition-colors focus:border-brand-green"
        />
      </div>
      <label className="flex flex-none items-center gap-2 text-[12px] font-semibold text-ink-muted">
        <span>Sort</span>
        <select
          name="board-sort"
          aria-label="Sort products"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as BoardSort)}
          className="rounded-[10px] border-[1.5px] border-line bg-white px-3 py-2.5 text-[13px] font-semibold text-ink outline-none transition-colors focus:border-brand-green"
        >
          {BOARD_SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === 'progress' ? progressLabel : o.label}
            </option>
          ))}
        </select>
      </label>
      {/* Announced, not drawn: a sighted customer sees the board shrink, a
          screen-reader user gets told. */}
      <output aria-live="polite" className="sr-only">
        {query.trim() ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'} for ${query.trim()}` : ''}
      </output>
    </div>
  );
}
