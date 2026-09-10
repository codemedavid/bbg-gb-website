// What is on a board, and what is in the archive. Pure: no I/O, no clock.
//
// A cycle turns and the boards go back to zero. That is the promise the admin
// screens make, and it cannot be kept by status alone: a counter sealed at the
// end of August is 'closed' in exactly the way a counter sealed this morning
// is, and a board that lists by status shows both — last cycle's 6/10 beside
// this cycle's 0/10, product after product, until the past outnumbers the
// present. So each listing carries the cycle it traded in (group_buys.cycle_key,
// moq_campaigns.cycle_key), and the rule is:
//
//   on the board  = still trading, OR ended in the CURRENT cycle
//   in the archive = ended in an earlier cycle
//
// Nothing is deleted or zeroed. The archive is the same rows, read by cycle.
import type { GroupBuy, MoqCampaign } from './types';

type KahatiStatus = GroupBuy['status'];
type CampaignStatus = MoqCampaign['status'];

/** Counters still taking or deciding on vials. */
export const LIVE_KAHATI_STATUSES: readonly KahatiStatus[] = ['scheduled', 'open', 'pasalo'];

/** Batches still taking kits. An approved batch is proceeding, not trading. */
export const LIVE_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['scheduled', 'open'];

type Filed = { cycleKey: string | null };

function isOnBoard(live: readonly string[], row: Filed & { status: string }, currentKey: string | null): boolean {
  if (live.includes(row.status)) return true;
  return row.cycleKey !== null && row.cycleKey === currentKey;
}

/** Whether a counter belongs on the Hatian board for the cycle `currentKey`. */
export function isOnKahatiBoard(row: Filed & { status: KahatiStatus }, currentKey: string | null): boolean {
  return isOnBoard(LIVE_KAHATI_STATUSES, row, currentKey);
}

/** Whether a batch belongs on the Group Buy board for the cycle `currentKey`. */
export function isOnCampaignBoard(row: Filed & { status: CampaignStatus }, currentKey: string | null): boolean {
  return isOnBoard(LIVE_CAMPAIGN_STATUSES, row, currentKey);
}

export type ArchiveOrderRow = Filed & { status: string };
export type ArchiveKahatiRow = Filed & { status: KahatiStatus; claimedSlots: number };
export type ArchiveCampaignRow = Filed & { status: CampaignStatus; committed: number };

/** One cycle as the archive lists it. */
export type CycleSummary = {
  cycleKey: string;
  orders: number;
  cancelledOrders: number;
  kahatis: number;
  /** Vials on counters that went ahead. Refunded counters are out. */
  vials: number;
  campaigns: number;
  /** Kits on batches that went ahead. */
  kits: number;
};

const EMPTY = (cycleKey: string): CycleSummary => ({
  cycleKey, orders: 0, cancelledOrders: 0, kahatis: 0, vials: 0, campaigns: 0, kits: 0,
});

/**
 * One row per cycle, newest first.
 *
 * Every named cycle appears, whether it holds orders, listings, or both — a
 * cycle whose orders were all placed against listings that later moved on is
 * still a cycle the team ran. Rows with no cycle key are from before cycles
 * were named and belong to none.
 */
export function summarizeCycles(input: {
  orders: readonly ArchiveOrderRow[];
  kahatis: readonly ArchiveKahatiRow[];
  campaigns: readonly ArchiveCampaignRow[];
}): CycleSummary[] {
  const byKey = new Map<string, CycleSummary>();
  const at = (key: string) => byKey.get(key) ?? EMPTY(key);

  for (const o of input.orders) {
    if (!o.cycleKey) continue;
    const seen = at(o.cycleKey);
    byKey.set(o.cycleKey, {
      ...seen,
      orders: seen.orders + 1,
      cancelledOrders: seen.cancelledOrders + (o.status === 'cancelled' ? 1 : 0),
    });
  }
  for (const k of input.kahatis) {
    if (!k.cycleKey) continue;
    const seen = at(k.cycleKey);
    byKey.set(k.cycleKey, {
      ...seen,
      kahatis: seen.kahatis + 1,
      vials: seen.vials + (k.status === 'cancelled' ? 0 : k.claimedSlots),
    });
  }
  for (const c of input.campaigns) {
    if (!c.cycleKey) continue;
    const seen = at(c.cycleKey);
    byKey.set(c.cycleKey, {
      ...seen,
      campaigns: seen.campaigns + 1,
      kits: seen.kits + (c.status === 'cancelled' ? 0 : c.committed),
    });
  }

  // Keys are ISO instants, so lexical order is chronological order.
  return [...byKey.values()].sort((a, b) => b.cycleKey.localeCompare(a.cycleKey));
}

const MANILA_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric',
});

/** "Cycle of 5 Sep 2026" — the cycle named by the Manila date it opened on. */
export function cycleLabel(cycleKey: string): string {
  const part = (type: string) => MANILA_DATE.formatToParts(new Date(cycleKey)).find((p) => p.type === type)?.value ?? '';
  return `Cycle of ${part('day')} ${part('month')} ${part('year')}`;
}
