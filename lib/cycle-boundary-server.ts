// The boards start their new cycle themselves when the schedule opens one.
//
// lib/kahati-server.ts rollOpenKahatis and lib/moq-batch-server.ts
// rollOpenBatches decide WHAT a new cycle does to each listing: seal the ones
// people joined and open their successors, re-read the empty ones from the
// catalog. This decides WHEN it happens to all of them, and the answer is: on
// the first board read inside a cycle that has not yet been started.
//
// The two admin "Start new cycle" buttons run the same roll, and remain the way
// to end a cycle EARLY. But they cannot be the only trigger. A cycle is opened
// by the SCHEDULE — an admin edits the recurrence, or simply waits for the
// opening hour — and nothing about that presses a button. The boards of
// 2026-09-09 were read continuously after their cycle opened and went on
// showing August's listings at August's prices, and the previous cycle's joined
// counters, because the reset was waiting on an operator to remember it.
//
// So this rides the same lazy reconciliation every other lifecycle transition
// here rides (sweepKahatis, openDueBatches, the two seeders). There is still no
// cron and nothing that has to stay running.
//
// ---------------------------------------------------------------------------
// Why this stores a key, when lib/schedule.ts says to store nothing
//
// That warning is about a "currently open" flag, and it is right: a stored
// boolean drifts from the window it claims to describe, and the failure mode is
// a storefront stuck open. What is stored here is different in both directions.
//
// It is not derivable. "Has this cycle been refreshed" is genuinely state — the
// window says which cycle we are in, never what has already been done to it —
// and a refresh MUST be once per cycle, or every board read would reprice and an
// admin's deliberate mid-cycle discount would revert on the next page load.
//
// And it fails safe. The value is the cycle's own key, not a status: lose it,
// corrupt it, or restore an old backup, and the cycle refreshes again. A refresh
// is idempotent, so the cost of the bad case is one extra UPDATE against rows
// that already match the catalog.
// ---------------------------------------------------------------------------
import { ne, sql } from 'drizzle-orm';
import { getDb, settings } from '@/lib/db';
import { getCurrentCycle } from './settings';
import { cycleKeyOf } from './schedule-recurrence';
import { rollOpenKahatis } from './kahati-server';
import { rollOpenBatches } from './moq-batch-server';

type Db = Awaited<ReturnType<typeof getDb>>;

/** The settings row holding the cycle the boards were last refreshed for. */
export const BOARDS_REFRESHED_KEY = 'boards_refreshed_for_cycle';

export type BoardRefreshResult = {
  /** False when the cycle was already claimed, or when nothing is trading. */
  refreshed: boolean;
  /** Empty hatian counters brought forward. Zero unless this call won the claim. */
  kahatis: number;
  /** Empty campaign batches brought forward. Zero unless this call won the claim. */
  campaigns: number;
  /** Joined hatian counters sealed, each with a fresh successor opened. */
  sealedKahatis: number;
  /** Joined campaign batches sealed, each with the next batch opened. */
  sealedCampaigns: number;
};

const NOTHING: BoardRefreshResult = {
  refreshed: false, kahatis: 0, campaigns: 0, sealedKahatis: 0, sealedCampaigns: 0,
};

/**
 * Claim this cycle's refresh, atomically. True exactly once per cycle key.
 *
 * One statement, because the board is polled and a read-then-write would let two
 * requests both find the cycle unclaimed and both start repricing the same rows.
 * The upsert's `where` is what makes it exclusive: the UPDATE fires only if the
 * stored key is still a DIFFERENT cycle, so the second caller's statement
 * matches nothing, returns nothing, and reports the claim lost.
 */
async function claimCycle(db: Db, cycleKey: string): Promise<boolean> {
  const claimed = await db.insert(settings)
    .values({ key: BOARDS_REFRESHED_KEY, value: cycleKey })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: cycleKey, updatedAt: sql`now()` },
      where: ne(settings.value, cycleKey),
    })
    .returning({ key: settings.key });
  return claimed.length > 0;
}

/**
 * Starts the new cycle on both boards, once per cycle.
 *
 * Called from the two board routes, after their sweeps and BEFORE their seeders:
 * a listing that exists is rolled or refreshed first, and only then does the
 * seeder add one for a product that genuinely has none. The other order would
 * open a correctly-priced listing and then have nothing left to refresh, which
 * works by accident and reads as though the order does not matter.
 *
 * A dark board does nothing at all. There is no cycle to key the claim on, and
 * claiming one anyway would spend the next cycle's refresh on a closed board.
 *
 * This is the SAME operation as the two admin "Start new cycle" buttons —
 * rollOpenKahatis and rollOpenBatches — because a cycle boundary is what those
 * buttons stand in for. Every listing people joined belongs to the cycle that
 * just ended: the boards were shut between its close and this open, so nothing
 * on them can have been joined in the new cycle yet. Each one is sealed, its
 * commitments staying with it, and an empty successor opens in its place;
 * listings nobody joined are re-read from the catalog. Before this, the
 * boundary only repriced empties and left last cycle's joined counters trading
 * on as if they were this cycle's, until an operator remembered the button.
 *
 * Once claimed, a cycle is never rolled again by a board read: anything joined
 * from here on is this cycle's running batch, and only the admin controls end
 * one early.
 */
export async function refreshBoardsForNewCycle(
  db: Db,
  now: Date = new Date(),
): Promise<BoardRefreshResult> {
  const cycle = await getCurrentCycle(now);
  if (!cycle) return NOTHING;

  if (!await claimCycle(db, cycleKeyOf(cycle))) return NOTHING;

  // Each roll is individually contained: one listing whose product cannot be
  // read must not abort the reset for every other listing on the board, and
  // neither board's failure may throw into a customer's GET. rollOpenKahatis
  // contains per counter already; rollOpenBatches does not, so it is wrapped
  // here and its progress up to the failure stands.
  let kahati = { rolled: [] as unknown[], refreshed: 0 };
  let campaign = { rolled: [] as unknown[], refreshed: 0 };
  try {
    kahati = await rollOpenKahatis(db, now);
  } catch {
    // Left as it was. The next cycle tries again, and the board is still readable.
  }
  try {
    campaign = await rollOpenBatches(db, now);
  } catch {
    // As above.
  }

  return {
    refreshed: true,
    kahatis: kahati.refreshed,
    campaigns: campaign.refreshed,
    sealedKahatis: kahati.rolled.length,
    sealedCampaigns: campaign.rolled.length,
  };
}
