'use client';
import { php } from '@/lib/format';
import type { MoqCampaign } from '@/lib/types';

// A Group Buy (MOQ) campaign on the storefront board.
//
// Deliberately not a variant of GroupBuyCard: a hatian fills a fixed 10-vial kit
// and locks at the cap, whereas a campaign chases a supplier minimum it may
// overshoot, and carries a lifecycle (approve below MOQ / extend / cancel with
// refunds) that the hatian board has no concept of. Sharing one component would
// mean branching on kind in every line.

type OutcomeStyle = { label: string; className: string };

const OUTCOME: Record<MoqCampaign['outcome'], OutcomeStyle> = {
  awaiting_moq: { label: 'Awaiting MOQ', className: 'bg-warn-softbg text-[#8a6400]' },
  processing: { label: 'Processing', className: 'bg-[#e8f5db] text-brand-greendark' },
  refunded: { label: 'Cancelled — refunded', className: 'bg-[#fdeaea] text-[#a33]' },
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
  const closes = deadlineLabel(c.deadline);
  // A campaign may exceed its MOQ, so the bar caps at 100% while the count does
  // not — "14 / 10 kits" is the honest number and reads as momentum.
  const barWidth = `${Math.min(1, c.progress) * 100}%`;

  return (
    <article className="flex flex-col gap-3 rounded-[14px] bg-white p-4 shadow-card">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 font-display text-[15px] font-bold leading-tight text-ink">{c.name}</h3>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {php(c.pricePerKitPhp)} per kit · min {c.perCustomerMin} kit{c.perCustomerMin === 1 ? '' : 's'}
          </p>
        </div>
        <span className={`flex-none rounded-full px-2.5 py-1 text-[11px] font-bold ${outcome.className}`}>
          {outcome.label}
        </span>
      </header>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
          <span className="font-bold text-ink">{c.committed} / {c.moq} kits</span>
          <span className="text-ink-muted">
            {c.reached ? 'MOQ reached 🎉' : `${c.remaining} more to unlock`}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`${c.name} MOQ progress`}
          aria-valuenow={c.committed}
          aria-valuemin={0}
          aria-valuemax={c.moq}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-mist"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${c.reached ? 'bg-brand-green' : 'bg-brand-blue'}`}
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
          {isOpen ? 'Commit kits' : 'Closed'}
        </button>
      </footer>
    </article>
  );
}
