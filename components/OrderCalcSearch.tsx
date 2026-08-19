'use client';
import { useState } from 'react';
import { php } from '@/lib/format';
import { searchProducts, stockState, vialPrice, type CalcProduct, type StockState } from '@/lib/order-calc';
import { StepCard } from './OrderCalcStep';

// Availability is a badge, not a gate. An out-of-stock vial still has a price,
// and quoting it is the whole point of reading a pricelist — so every row stays
// tappable and the badge carries the caveat.
const BADGE: Record<StockState, { label: string; className: string }> = {
  in: { label: 'IN STOCK', className: 'bg-[#e8f5db] text-brand-greendark' },
  low: { label: 'LOW STOCK', className: 'bg-warn-bg text-warn-fg' },
  out: { label: 'OUT OF STOCK', className: 'bg-surface-mist text-ink-faint' },
};

export function OrderCalcSearch({ products, query, onQuery, onAdd, loading = false }: {
  products: CalcProduct[];
  query: string;
  onQuery: (q: string) => void;
  onAdd: (id: string) => void;
  loading?: boolean;
}) {
  // Focus lives here rather than on the page: opening the pricelist on tap is a
  // property of this control, and nothing above it needs to know.
  const [focused, setFocused] = useState(false);
  const results = searchProducts(products, query);
  const showResults = focused || query.trim().length > 0;

  return (
    <StepCard step={1} title="Add products" aside={loading ? 'Loading…' : `${products.length} products`}>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">🔍</span>
        <input
          type="search"
          aria-label="Search products"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Search by name or code…"
          className="w-full rounded-[10px] border-[1.5px] border-line bg-white py-2.5 pl-9 pr-3.5 text-[14px] outline-none transition-colors focus:border-brand-green"
        />
      </div>

      {showResults && (
        <div className="mt-2.5 max-h-[340px] overflow-y-auto rounded-[12px] border border-line-soft">
          {results.length === 0 ? (
            <p className="px-4 py-[18px] text-[13px] text-ink-muted">
              No products match “{query}”. Try a shorter word or a product code.
            </p>
          ) : (
            results.map((p) => {
              const badge = BADGE[stockState(p.stock)];
              return (
                <button key={p.id} onClick={() => onAdd(p.id)} aria-label={`Add ${p.name} to order`}
                  className="flex w-full items-center gap-3 border-b border-line-soft px-3.5 py-3 text-left last:border-b-0 transition-colors hover:bg-surface-mist active:bg-surface-mist">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="break-words text-[13.5px] font-bold leading-tight text-ink">{p.name}</span>
                    <span className="flex items-center gap-2 text-[11.5px] text-ink-muted">
                      {p.code && <span className="font-bold tracking-wide text-brand-greendark">{p.code}</span>}
                      {p.spec && <span className="truncate">{p.spec}</span>}
                    </span>
                  </span>
                  <span className="flex flex-none flex-col items-end gap-1">
                    <span className="whitespace-nowrap font-display text-[13.5px] font-bold text-ink">{php(vialPrice(p))}</span>
                    <span className={`whitespace-nowrap rounded-full px-2 py-px text-[9.5px] font-bold tracking-wide ${badge.className}`}>
                      {badge.label}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </StepCard>
  );
}
