'use client';
import type { PasaloCounter } from '@/lib/types';
import { php, closesIn } from '@/lib/format';
import { pasaloSecuredNotice } from '@/lib/pasalo';

// One counter on the Pasalo (Bunuan) board.
//
// A deliberate sibling of GroupBuyCard rather than a mode of it. The Kahati
// card sells a batch that is filling; this one sells a batch that is about to
// be REFUNDED unless somebody helps, and the two want opposite emphasis. Here
// the headline number is what the batch still needs, the deadline is urgent
// rather than incidental, and a secured batch says so plainly so a customer
// topping it up knows they are adding margin, not rescuing it.
//
// The claimed figure is split into its two halves — Kahati and Pasalo — because
// "5 / 10" alone hides that three of those vials were already committed by
// people whose money is at stake.
export function PasaloCard({ c, onJoin }: { c: PasaloCounter; onJoin: (c: PasaloCounter) => void }) {
  const secured = c.neededToQualify === 0;
  const full = c.slotsRemaining === 0;
  const progress = Math.min(100, Math.round((c.claimedSlots / Math.max(c.totalSlots, 1)) * 100));
  // Where the batch becomes viable, drawn on the bar. It is the number that
  // decides whether anything ships at all, so it earns a mark of its own.
  const minMarkerPct = Math.min(100, Math.round((c.minViableVials / c.totalSlots) * 100));

  return (
    <article className={`rounded-[16px] bg-white p-4 shadow-card transition-shadow duration-200 hover:shadow-lg ${
      secured ? '' : 'ring-1 ring-warn-softln'}`}>
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-[15px] font-bold text-ink">{c.name}</h3>
        <span className={`flex-none rounded-md px-2 py-[3px] text-[10.5px] font-bold ${
          full ? 'bg-line text-ink-body'
            : secured ? 'bg-[#e8f5db] text-brand-greendark'
              : 'bg-warn-bg text-warn-fg'}`}>
          {full ? 'FULL' : secured ? 'SECURED' : 'PASALO'}
        </span>
      </div>

      <p className="m-0 mb-2.5 text-[12px] text-ink-muted">
        {php(c.perVialPhp)}/vial · min {c.minVials} {c.minVials === 1 ? 'vial' : 'vials'}
        {c.pasaloClosesAt && <> · sarado {closesIn(c.pasaloClosesAt)}</>}
      </p>

      <div className="mb-1.5 flex items-center gap-2.5">
        <div className="relative h-[9px] flex-1 overflow-hidden rounded-full bg-[#edf2ea]">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${
              secured ? 'bg-gradient-to-r from-brand-blue to-brand-green' : 'bg-gradient-to-r from-warn-fg to-brand-green'}`}
            style={{ width: `${progress}%` }}
          />
          <span aria-hidden className="absolute top-0 h-full w-[2px] bg-brand-navy/45"
            style={{ left: `${minMarkerPct}%` }} />
        </div>
        <span className="flex-none text-[12px] font-bold text-brand-greendark">
          {c.claimedSlots}/{c.totalSlots}
        </span>
      </div>

      {/* The split, said out loud. Three of these vials belong to people whose
          money is already committed, and that is the reason to help. */}
      <p className="m-0 mb-2 text-[11px] text-ink-muted">
        {c.kahatiVials} claimed sa Kahati
        {c.pasaloVials > 0 && <> · {c.pasaloVials} sa Pasalo</>}
      </p>

      <p className={`m-0 mb-3 text-[12px] font-bold ${
        secured ? 'text-brand-greendark' : 'text-warn-fg'}`}>
        {pasaloSecuredNotice(c)}
      </p>

      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] text-ink-muted">Per vial</div>
          <strong className="font-display text-[19px] text-ink">{php(c.perVialPhp)}</strong>
        </div>
        <button
          type="button"
          disabled={full}
          onClick={() => onJoin(c)}
          className="rounded-[10px] bg-brand-green px-5 py-2.5 text-[13px] font-bold text-white transition-transform duration-150 active:scale-95 disabled:bg-ink-faint"
        >
          {full ? 'Puno na' : 'Take Pasalo slot'}
        </button>
      </div>
    </article>
  );
}
