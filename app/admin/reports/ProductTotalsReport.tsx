'use client';
import type { ProductTotals } from '@/lib/report/product-totals';

// On-page counterpart to the workbook's "Product Totals" sheet: the week's
// orders rolled up per product, ranked by quantity, which is the shape the
// batch order is placed in.
const usd = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Kits divide out evenly far more often than not, so a fixed 1-decimal format
// would print "27.0" for every whole kit. Trailing zeros are dropped instead.
const kits = (n: number) => String(Number(n.toFixed(2)));

function Tile({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-[14px] bg-white p-4 shadow-card" data-testid={testId}>
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 font-display text-[22px] font-bold text-ink">{value}</div>
    </div>
  );
}

// `segment` only scopes the heading id: the page renders this twice, once per
// half of the week, and two elements sharing an id break the aria-labelledby
// link for whichever one the browser resolves second.
export function ProductTotalsReport(
  { productTotals, segment }: { productTotals: ProductTotals; segment?: string },
) {
  const { rows, totals } = productTotals;
  const headingId = segment ? `product-totals-${segment}-heading` : 'product-totals-heading';

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div>
        <h2 id={headingId} className="m-0 font-display text-[18px] font-bold">Product Totals</h2>
        <p className="mt-1 text-[13px] text-ink-muted">Every product ordered this week, ranked by quantity.</p>
      </div>

      {!rows.length ? (
        <div className="rounded-[14px] bg-white p-6 text-center text-[13px] text-ink-muted shadow-card">
          No products sold in this period.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Products" value={String(rows.length)} testId="tile-products" />
            <Tile label="Units" value={String(totals.qty)} testId="tile-units" />
          </div>

          <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-3">#</th><th className="px-3 py-3">Product</th>
                  <th className="px-3 py-3">Variant / Code</th><th className="px-3 py-3">Specs</th>
                  <th className="px-3 py-3 text-right">Total USD</th><th className="px-3 py-3 text-right">Total Qty</th>
                  <th className="px-3 py-3 text-right">Kits</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.code}|${r.name}|${r.spec}`} className="border-b border-line-soft/60">
                    <td className="px-3 py-3 text-ink-muted">{r.index}</td>
                    <td className="px-3 py-3 font-semibold text-ink">{r.name}</td>
                    <td className="px-3 py-3 text-ink-body" data-testid="product-total-code">{r.code}</td>
                    <td className="px-3 py-3 text-ink-body">{r.spec}</td>
                    <td className="px-3 py-3 text-right text-ink-body">{usd(r.usd)}</td>
                    <td className="px-3 py-3 text-right font-display font-bold text-ink">{r.qty}</td>
                    <td className="px-3 py-3 text-right text-ink-body">{kits(r.kits)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#dff0d6] font-bold">
                  <td className="px-3 py-3" colSpan={4}>Total ({rows.length} products)</td>
                  <td className="px-3 py-3 text-right">{usd(totals.usd)}</td>
                  <td className="px-3 py-3 text-right font-display">{totals.qty}</td>
                  <td className="px-3 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
