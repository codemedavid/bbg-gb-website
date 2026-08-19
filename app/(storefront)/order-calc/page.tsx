'use client';
import { useMemo, useState } from 'react';
import { BackHeader } from '@/components/headers';
import { OrderCalcSearch } from '@/components/OrderCalcSearch';
import { OrderCalcLines } from '@/components/OrderCalcLines';
import { OrderCalcSummary } from '@/components/OrderCalcSummary';
import { useProducts, usePackingFees } from '@/lib/queries';
import { buildLines, orderTotals, addEntry, setEntryQty, type CalcEntry } from '@/lib/order-calc';
import { PACKING_FEE_PHP, type PackingMode } from '@/lib/pricing';

// A quote, not an order. Nothing here writes to the cart — the customer builds
// a number to decide with, and decides where to buy it separately. That is why
// the fulfilment mode is a control rather than an inference: the same basket
// costs three different amounts to pack depending on which board it goes
// through, and the calculator has no way to know which one the customer means.
export default function OrderCalcPage() {
  const { data: products = [], isLoading } = useProducts({});
  const { data: fees } = usePackingFees();

  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<CalcEntry[]>([]);
  const [mode, setMode] = useState<PackingMode>('solo');

  const lines = useMemo(() => buildLines(products, entries), [products, entries]);
  // Live fees where they have loaded; the code defaults only while they have
  // not, so the bar never shows a blank or a zero it does not mean.
  const fee = fees?.[mode] ?? PACKING_FEE_PHP[mode];
  const totals = orderTotals(lines, fee);

  return (
    <>
      <BackHeader title="Order Calculator" showHome />
      {/* Room for both fixed bars: the summary at bottom-[76px] plus its own
          height, so the last line is never trapped underneath. */}
      <div className="flex flex-col gap-3.5 p-4 pb-[150px] md:p-6 md:pb-[150px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-bold leading-tight text-ink">Order Calculator</h1>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              Hanapin ang produkto, i-set ang dami ng vials, at makikita mo agad ang total. Per-vial pricing in PHP.
            </p>
          </div>
          <span className="flex-none rounded-full border border-brand-green bg-[#e8f5db] px-2.5 py-1 text-[9.5px] font-bold tracking-wider text-brand-greendark">
            LIVE ESTIMATE
          </span>
        </div>

        <OrderCalcSearch
          products={products}
          query={query}
          onQuery={setQuery}
          onAdd={(id) => { setEntries((e) => addEntry(e, id)); setQuery(''); }}
          loading={isLoading}
        />

        <OrderCalcLines
          lines={lines}
          onQty={(id, qty) => setEntries((e) => setEntryQty(e, id, qty))}
        />
      </div>

      <OrderCalcSummary totals={totals} mode={mode} onMode={setMode} />
    </>
  );
}
