'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiSend } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import { field, btnPrimary, btnGhost } from '@/components/admin-ui';
import { refundCsv, type RefundRow, type RefundSummary, type RefundTier } from '@/lib/report/refund';

// Refund export: who to pay back when a batch arrives short.
//
// The supplier's sheet names SKUs and pesos but no customers, so on its own it
// cannot be acted on. Paste it here against the batch's date window and it
// comes back joined to real buyers — name, phone, email, order number.
//
// The screen deliberately shows the join BEFORE offering the download. A row
// matched by price rather than by supplier code is a guess, and an admin about
// to send money is the right person to catch a wrong one.

type RefundResponse = {
  from: string;
  to: string;
  rows: RefundRow[];
  summary: RefundSummary;
  skipped: string[];
};

const BUY_TYPES = [
  { value: 'kahati', label: 'Kahati' },
  { value: 'group_buy', label: 'Group Buy' },
  { value: 'moq', label: 'MOQ' },
  { value: 'solo', label: 'On-hand' },
] as const;

const TIER_STYLE: Record<RefundTier, { label: string; className: string; hint: string }> = {
  CONFIRMED: {
    label: 'Ready to send',
    className: 'bg-[#e8f5ec] text-[#1c6b3a] border-[#bfe3cb]',
    hint: 'The shortfall is everything the batch sold of this SKU, so each buyer is refunded in full.',
  },
  ALLOCATE: {
    label: 'Needs your call',
    className: 'bg-[#fff4e5] text-[#8a5200] border-[#f5d9ae]',
    hint: 'More was ordered than is short. Pick who goes unfilled — no amount has been decided.',
  },
  SHORT: {
    label: 'Check the sheet',
    className: 'bg-[#fdeaea] text-[#9b2226] border-[#f3c4c4]',
    hint: 'The sheet asks for more than this batch ever sold. Something is wrong upstream.',
  },
  UNMATCHED: {
    label: 'No buyer found',
    className: 'bg-[#f0eefb] text-[#4b3f9e] border-[#d5cef3]',
    hint: 'Nothing in the batch could be tied to this SKU. Map its supplier code on the product.',
  },
};

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Save the joined rows as a CSV the team can work through in Excel. */
function downloadRefundCsv(rows: RefundRow[], from: string, to: string): void {
  // A BOM so Excel opens the file as UTF-8 — without it the peptide names and
  // the ñ in a customer's name arrive mojibaked.
  const blob = new Blob([`﻿${refundCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // The anchor must be in the document for a synthetic click to register in
  // Firefox, and the object URL must outlive the click — revoking in the same
  // tick invalidates the blob before the browser has read it.
  const link = document.createElement('a');
  link.href = url;
  link.download = `BBG-refund-${from}-to-${to}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 0);
}

export function RefundExport({ from, to }: { from: string; to: string }) {
  const [paste, setPaste] = useState('');
  const [buyTypes, setBuyTypes] = useState<string[]>(['kahati']);
  const [result, setResult] = useState<RefundResponse | null>(null);
  const showToast = useToast((s) => s.show);

  const match = useMutation({
    mutationFn: () => apiSend<RefundResponse>('/admin/report/refund', 'POST', { from, to, paste, buyTypes }),
    onSuccess: setResult,
    onError: (err: unknown) => showToast(err instanceof Error ? err.message : 'Could not match the sheet.'),
  });

  const toggleBuyType = (value: string) => {
    // Never leave the set empty: an empty filter matches no orders at all, and
    // the resulting "nothing found" reads as a data problem rather than a
    // checkbox one.
    setBuyTypes((prev) => (
      prev.includes(value)
        ? (prev.length > 1 ? prev.filter((v) => v !== value) : prev)
        : [...prev, value]
    ));
  };

  const summary = result?.summary;

  return (
    <section className="rounded-[14px] border border-line-soft bg-white p-4">
      <header>
        <h2 className="m-0 font-display text-[17px] font-bold">Refund export</h2>
        <p className="mt-1 text-[13px] leading-snug text-ink-muted">
          Paste the supplier&rsquo;s refund sheet — SKU, kits, amount — and it comes back joined to the buyers
          in this date window, with their contact details.
        </p>
      </header>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <label className="text-[12px] font-semibold text-ink-body">
          Refund sheet
          <textarea
            aria-label="Refund sheet paste"
            className={`${field} mt-1 h-40 resize-y font-mono text-[12.5px]`}
            placeholder={'BPC10\t0.4\t1500\nGHK50\t0.1\t220\nGLOW\t0.5\t4600'}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-ink-body">Search which orders</span>
          {BUY_TYPES.map((t) => (
            <label
              key={t.value}
              className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-line-soft px-3 py-2 text-[13px] font-semibold text-ink-body has-[:checked]:border-brand-green has-[:checked]:bg-[#f0f8f3]"
            >
              <input
                type="checkbox"
                checked={buyTypes.includes(t.value)}
                onChange={() => toggleBuyType(t.value)}
              />
              {t.label}
            </label>
          ))}
          <button
            type="button"
            className={`${btnPrimary} mt-1`}
            disabled={!paste.trim() || match.isPending}
            onClick={() => match.mutate()}
          >
            {match.isPending ? 'Matching…' : 'Match to buyers'}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-4 flex flex-col gap-3">
          {summary && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryTile label="Ready to send" value={peso(summary.confirmedPhp)} note={`${summary.confirmedRows} buyers`} tone="good" />
              <SummaryTile label="Needs your call" value={peso(summary.allocatePhp)} note={`${summary.allocateRows} candidates`} tone="warn" />
              <SummaryTile label="No buyer found" value={peso(summary.unmatchedPhp)} note={summary.unmatchedSkus.join(', ') || '—'} tone="info" />
              <SummaryTile label="Sheet total" value={peso(summary.sheetTotalPhp)} note="tie this to the sheet's own TOTAL" tone="plain" />
            </div>
          )}

          {result.skipped.length > 0 && (
            <p className="m-0 rounded-[10px] bg-surface-mist px-3 py-2 text-[12px] text-ink-muted">
              Ignored {result.skipped.length} row{result.skipped.length === 1 ? '' : 's'} that read as headers or totals:{' '}
              <span className="font-mono">{result.skipped.join(' · ')}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={!result.rows.length}
              onClick={() => downloadRefundCsv(result.rows, result.from, result.to)}
            >
              Download refund CSV
            </button>
            <button type="button" className={btnGhost} onClick={() => setResult(null)}>Clear</button>
            <span className="text-[12px] text-ink-muted">{result.rows.length} rows</span>
          </div>

          <RefundTable rows={result.rows} />
        </div>
      )}
    </section>
  );
}

function SummaryTile({ label, value, note, tone }: {
  label: string; value: string; note: string; tone: 'good' | 'warn' | 'info' | 'plain';
}) {
  const toneClass = {
    good: 'border-[#bfe3cb] bg-[#f4fbf6]',
    warn: 'border-[#f5d9ae] bg-[#fffaf2]',
    info: 'border-[#d5cef3] bg-[#f8f7fe]',
    plain: 'border-line-soft bg-surface-mist',
  }[tone];

  return (
    <div className={`rounded-[12px] border px-3 py-2.5 ${toneClass}`}>
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-0.5 font-display text-[18px] font-bold text-ink">{value}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-ink-muted" title={note}>{note}</div>
    </div>
  );
}

function RefundTable({ rows }: { rows: RefundRow[] }) {
  if (!rows.length) return <p className="text-[13px] text-ink-muted">No rows matched.</p>;

  return (
    // Wide on purpose, so it scrolls inside its own box rather than pushing the
    // page sideways on a phone.
    <div className="overflow-x-auto rounded-[12px] border border-line-soft">
      <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-surface-mist text-left">
            {['Status', 'SKU', 'Matched by', 'Order', 'Customer', 'Contact', 'Vials', 'Refund'].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold text-ink-body">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const tier = TIER_STYLE[r.tier];
            return (
              <tr key={`${r.sku}-${r.orderNo}-${i}`} className="border-t border-line-soft align-top">
                <td className="px-3 py-2">
                  <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${tier.className}`} title={tier.hint}>
                    {tier.label}
                  </span>
                </td>
                <td className="px-3 py-2 font-semibold">{r.sku}</td>
                <td className="px-3 py-2">
                  {/* A price match is a guess and says so — the supplier's codes
                      are not ours, so an unmapped product is matched on what it
                      charged per vial and could in principle collide. */}
                  {r.matchedBy === 'unit_price'
                    ? <span className="text-[#8a5200]" title="Guessed from the per-vial price. Map this product&rsquo;s supplier code to make it exact.">price (guess)</span>
                    : <span className="text-ink-muted">{r.matchedBy.replace('_', ' ')}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.orderNo || '—'}
                  {r.orderStatus && <div className="text-[11px] text-ink-muted">{r.orderStatus.replace(/_/g, ' ')}</div>}
                </td>
                <td className="px-3 py-2">{r.customer || '—'}</td>
                <td className="px-3 py-2">
                  {r.phone && <div className="whitespace-nowrap">{r.phone}</div>}
                  {r.email && <div className="text-[11px] text-ink-muted">{r.email}</div>}
                  {!r.phone && !r.email && '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.vialsOrdered || '—'}
                  {r.perVialPhp > 0 && <div className="text-[11px] text-ink-muted">@ {peso(r.perVialPhp)}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold">
                  {r.refundDuePhp === null
                    ? <span className="text-ink-muted">— of {peso(r.skuRefundPhp)}</span>
                    : peso(r.refundDuePhp)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
