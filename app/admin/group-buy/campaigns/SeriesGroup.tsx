'use client';
// One group buy on the admin board: the batch that is live now, with the
// batches before it folded away behind it.
//
// A series that has run for a month is six or seven rows, and only one of them
// is a decision — the rest are records. Folding them keeps the board the length
// of the catalogue rather than the length of its history, and keeps every past
// batch one click away instead of one search away.
import { useState } from 'react';
import { CampaignCard, type CampaignActions } from './CampaignCard';
import type { SeriesGroup as Series } from '@/lib/campaign-series';

type Props = { group: Series; busy: boolean; actions: CampaignActions };

export function SeriesGroup({ group, busy, actions }: Props) {
  const [showPast, setShowPast] = useState(false);
  const { current, past } = group;
  const historyId = `past-${group.seriesId}`;

  return (
    <section className="flex flex-col gap-2" aria-label={`${group.name} batches`}>
      <CampaignCard c={current} busy={busy} actions={actions} />

      {past.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowPast((open) => !open)}
            aria-expanded={showPast}
            aria-controls={historyId}
            className="flex items-center gap-1.5 self-start rounded-full px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted transition-colors hover:text-brand-blue"
          >
            {/* Rotated, not swapped: the turn is the affordance, and transform
                keeps it off the layout path. */}
            <span aria-hidden className={`inline-block transition-transform duration-200 ${showPast ? 'rotate-90' : ''}`}>›</span>
            Past batches ({past.length})
          </button>

          {showPast && (
            <div id={historyId} className="flex flex-col gap-2 border-l-2 border-line pl-3">
              {past.map((c) => (
                <CampaignCard key={c.id} c={c} busy={busy} actions={actions} muted />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
