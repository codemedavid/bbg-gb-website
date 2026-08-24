'use client';
// One batch on the admin campaign board.
//
// The same card serves the live batch at the head of a series and the finished
// ones inside its archive: an archived batch is history to read, not a
// read-only shelf — a supplier can still fall through after a batch closed, so
// its actions have to keep working wherever the card is rendered.
import { php } from '@/lib/format';
import type { MoqCampaign } from '@/lib/types';

const OUTCOME_LABEL: Record<MoqCampaign['outcome'], string> = {
  awaiting_moq: 'Awaiting MOQ', processing: 'Processing', refunded: 'Refunded',
};

const STATUS_STYLE: Record<MoqCampaign['status'], string> = {
  // Written but not yet on the board — it opens on its own when opensAt passes.
  scheduled: 'bg-[#f5eddb] text-brand-navy',
  open: 'bg-[#e8f5db] text-brand-greendark',
  approved: 'bg-[#dbe8f5] text-brand-blue',
  // Reached its kit cap and closed itself; its successor is already open.
  completed: 'bg-[#dbe8f5] text-brand-navy',
  cancelled: 'bg-line text-ink-body',
};

// grow + a real minimum, never `flex-1`: a zero basis can shrink past its
// label forever, so six actions stayed jammed on one row and shredded
// "End & start next" into a column of letters inside a three-up card. With a
// floor to overflow against, the row wraps instead of squeezing.
const cardAction = 'min-w-[7.5rem] grow whitespace-nowrap rounded-[9px] border border-line px-2 py-1.5 text-[13px] font-semibold transition-colors hover:border-brand-blue disabled:opacity-50 disabled:hover:border-line';

/** What the board can do to a batch. The page owns every one of them. */
export type CampaignActions = {
  edit: (c: MoqCampaign) => void;
  participants: (c: MoqCampaign) => void;
  approve: (c: MoqCampaign) => void;
  /** End this batch and open the next one in the same series. */
  roll: (c: MoqCampaign) => void;
  extend: (c: MoqCampaign) => void;
  cancel: (c: MoqCampaign) => void;
  remove: (c: MoqCampaign) => void;
};

type Props = {
  c: MoqCampaign;
  busy: boolean;
  actions: CampaignActions;
  /** Archived batches sit inside an open history, so they read quieter. */
  muted?: boolean;
};

export function CampaignCard({ c, busy, actions, muted = false }: Props) {
  const pct = Math.round(c.progress * 100);
  return (
    <article
      data-testid={`campaign-${c.id}`}
      className={`rounded-[16px] p-4 ${muted ? 'bg-[#fafaf8] shadow-none ring-1 ring-line' : 'bg-white shadow-card'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 break-words font-bold text-ink">{c.name} <span className="text-ink-muted">· Batch #{c.batchNo}</span></div>
        <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[c.status]}`}>{c.status}</span>
      </div>
      <div className="mt-1 text-[12px] text-ink-muted">{php(c.pricePerKitPhp)}/kit · {OUTCOME_LABEL[c.outcome]}</div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf2ea]">
        <div className="h-full bg-gradient-to-r from-brand-blue to-brand-green" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="mt-1 text-[12px] font-semibold text-brand-greendark">
        {c.committed}/{c.capacity} kits{c.full ? ' · batch full' : ` · ${c.remaining} slot${c.remaining === 1 ? '' : 's'} left`}
      </div>
      {c.deadline && <div className="mt-1 text-[11px] text-ink-muted">Deadline: {new Date(c.deadline).toLocaleString()}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => actions.edit(c)}
          aria-label={`Edit ${c.name}`} className={`${cardAction} text-brand-blue`} disabled={busy}>Edit</button>
        <button onClick={() => actions.participants(c)}
          aria-label={`View participants in ${c.name}`} className={`${cardAction} text-ink-body`} disabled={busy}>Participants</button>
        {c.status === 'open' && <>
          <button onClick={() => actions.approve(c)}
            aria-label={`Approve ${c.name}`} className={`${cardAction} text-brand-greendark`} disabled={busy}>Approve</button>
          {/* Approve closes this batch and stops there; this closes it AND
              opens the next one, so the series carries on under the same card. */}
          <button onClick={() => actions.roll(c)}
            aria-label={`End batch #${c.batchNo} of ${c.name} and start the next`}
            className={`${cardAction} text-brand-blue`} disabled={busy}>End &amp; start next</button>
          <button onClick={() => actions.extend(c)}
            aria-label={`Extend ${c.name}`} className={`${cardAction} text-ink-body`} disabled={busy}>Extend</button>
        </>}
        {/* A full batch needs no approval and takes no extension, but a
            supplier can still fall through after it closed — so cancel
            stays available on a completed batch. */}
        {(c.status === 'open' || c.status === 'completed') && (
          <button onClick={() => actions.cancel(c)}
            aria-label={`Cancel ${c.name}`} className={`${cardAction} text-warn-fg`} disabled={busy}>Cancel</button>
        )}
        <button onClick={() => actions.remove(c)} aria-label={`Delete ${c.name}`}
          className="shrink-0 rounded-[9px] border border-line px-3 py-1.5 text-[13px] font-semibold text-[#b23b3b] transition-colors hover:border-[#b23b3b] disabled:opacity-50" disabled={busy}>✕</button>
      </div>
    </article>
  );
}
