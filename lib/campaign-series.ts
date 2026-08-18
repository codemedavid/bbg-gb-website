// Grouping the admin campaign board by series.
//
// The board lists batches, and a group buy that has run for six weeks is six
// rows — most of them finished. A finished batch is history: the admin needs it
// for participants and totals, not for a decision. So the board is grouped into
// one entry per series, fronted by the batch that is live and backed by an
// archive of the ones before it.
//
// Pure and view-only: nothing here writes, and the lifecycle rules stay in
// lib/group-buy.ts. Grouping decides what is shown first, never what is allowed.
import type { MoqCampaign } from './types';

/** Statuses that still take part in the group buy — the batch the admin acts on. */
const LIVE: ReadonlySet<MoqCampaign['status']> = new Set(['scheduled', 'open', 'approved']);

export const isLiveBatch = (c: MoqCampaign): boolean => LIVE.has(c.status);

export type SeriesGroup = {
  seriesId: string;
  /** The name the series is listed under — its current batch's name. */
  name: string;
  /** The batch fronting the group: the live one, or the last one if it ended. */
  current: MoqCampaign;
  /** Every other batch, newest first. Archived behind a toggle in the UI. */
  past: MoqCampaign[];
};

const byBatchDesc = (a: MoqCampaign, b: MoqCampaign) => b.batchNo - a.batchNo;

// The batch that fronts a series: the newest live one, or — for a series that
// ended — its newest batch, so a finished group buy stays on the board instead
// of disappearing with its participants.
function frontOf(batches: MoqCampaign[]): MoqCampaign {
  const newestFirst = [...batches].sort(byBatchDesc);
  return newestFirst.find(isLiveBatch) ?? newestFirst[0];
}

/**
 * Groups batches into one entry per series, sorted by name.
 *
 * A series is keyed by `seriesId`, never by name: two group buys may carry the
 * same name, and merging them would archive one series' batches under the
 * other's. Every batch the caller passes comes back in exactly one group —
 * grouping hides nothing, it only decides what is behind the toggle.
 */
export function groupBySeries(campaigns: MoqCampaign[]): SeriesGroup[] {
  const bySeries = new Map<string, MoqCampaign[]>();
  for (const c of campaigns) {
    bySeries.set(c.seriesId, [...(bySeries.get(c.seriesId) ?? []), c]);
  }

  return [...bySeries.entries()]
    .map(([seriesId, batches]) => {
      const current = frontOf(batches);
      return {
        seriesId,
        name: current.name,
        current,
        past: batches.filter((b) => b.id !== current.id).sort(byBatchDesc),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
