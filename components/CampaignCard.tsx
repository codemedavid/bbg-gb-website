'use client';
import { php } from '@/lib/format';
import type { MoqCampaign } from '@/lib/types';

// One Group Buy (MOQ) batch on the storefront board.
//
// Deliberately not a variant of GroupBuyCard: a hatian splits a 10-vial kit
// between people, whereas a batch pools whole kits and carries a lifecycle
// (approve below MOQ / extend / cancel with refunds) the hatian board has no
// concept of. Sharing one component would mean branching on kind in every line.

type Badge = { label: string; className: string };

const OUTCOME: Record<MoqCampaign['outcome'], Badge> = {
  awaiting_moq: { label: 'Awaiting MOQ', className: 'bg-warn-softbg text-[#8a6400]' },
  processing: { label: 'Processing', className: 'bg-[#e8f5db] text-brand-greendark' },
  refunded: { label: 'Cancelled — refunded', className: 'bg-[#fdeaea] text-[#a33]' },
};

// The batch's own state, shown next to the outcome: the outcome answers "what
// happens to my money", this answers "can I still join THIS batch".
const STATUS: Record<MoqCampaign['status'], Badge> = {
  open: { label: 'Open', className: 'bg-[#e8f5db] text-brand-greendark' },
  completed: { label: 'Completed', className: 'bg-[#dbe8f5] text-brand-navy' },
  approved: { label: 'Approved', className: 'bg-[#dbe8f5] text-brand-blue' },
  cancelled: { label: 'Cancelled', className: 'bg-line text-ink-body' },
};

const deadlineLabel = (iso: string | null): string | null => {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric',
  }).format(new Date(iso));
};

export function CampaignCard({ c, onCommit }: { c: MoqCampaign; onCommit: (c: MoqCampaign) => void }) {
  const isOpen = c.status === 'open';
  const outcome = OUTCOME[c.outcome];
  const status = STATUS[c.status];
  const closes = deadlineLabel(c.deadline);
  // A batch cannot exceed its capacity, so the count and the bar agree: the
  // fullest this ever reads is 10 / 10 kits, and the overflow is batch #2.
  const barWidth = `${Math.min(1, c.progress) * 100}%`;

  return (
    <article className="flex flex-col gap-3 rounded-[14px] bg-white p-4 shadow-card">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 font-display text-[15px] font-bold leading-tight text-ink">{c.name}</h3>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Batch #{c.batchNo} · {php(c.pricePerKitPhp)} per kit
          </p>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.className}`}>
            {status.label}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${outcome.className}`}>
            {outcome.label}
          </span>
        </div>
      </header>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
          <span className="font-bold text-ink">{c.committed} / {c.capacity} kits</span>
          <span className="text-ink-muted">
            {c.full
              ? 'Batch full 🎉'
              : isOpen
                ? `${c.remaining} slot${c.remaining === 1 ? '' : 's'} left`
                : `${c.remaining} unfilled`}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`Batch #${c.batchNo} of ${c.name} — kits committed`}
          aria-valuenow={c.committed}
          aria-valuemin={0}
          aria-valuemax={c.capacity}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-mist"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${c.full ? 'bg-brand-green' : 'bg-brand-blue'}`}
            style={{ width: barWidth }}
          />
        </div>
      </div>

      {c.description && <p className="m-0 text-[12.5px] leading-snug text-ink-body">{c.description}</p>}

      <footer className="flex items-center justify-between gap-3">
        <span className="text-[11.5px] text-ink-muted">
          {closes ? `Closes ${closes}` : 'No deadline set'}
          {' · '}
          {php(c.shippingPhp)} packing fee
        </span>
        <button
          type="button"
          disabled={!isOpen}
          onClick={() => onCommit(c)}
          className="rounded-full bg-brand-blue px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-brand-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-faint"
        >
          {isOpen ? 'Commit kits' : c.status === 'completed' ? 'Batch full' : 'Closed'}
        </button>
      </footer>
    </article>
  );
}
