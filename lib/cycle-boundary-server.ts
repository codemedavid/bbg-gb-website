// The boards re-read themselves when a new cycle opens.
//
// lib/listing-sync.ts decides WHAT a refresh does to one listing. This decides
// WHEN it happens to all of them, and the answer is: on the first board read
// inside a cycle the boards have not yet been refreshed for.
//
// The two admin "Start new cycle" buttons already refresh (rollOpenKahatis,
// rollOpenBatches), and they remain the control for ENDING batches people have
// joined. But they cannot be the only trigger for the reset. A cycle is opened
// by the SCHEDULE — an admin edits the recurrence, or simply waits for 22:00
// Manila — and nothing about that press a button. The boards of 2026-09-09 were
// read continuously after their cycle opened and went on showing August's
// listings at August's prices, because the reset was waiting on an operator to
// remember it.
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
import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb, groupBuys, moqCampaigns, settings } from '@/lib/db';
import { getCurrentCycle } from './settings';
import { cycleKeyOf } from './schedule-recurrence';
import { refreshEmptyKahati, refreshEmptyCampaign } from './listing-sync-server';

type Db = Awaited<ReturnType<typeof getDb>>;

/** The settings row holding the cycle the boards were last refreshed for. */
export const BOARDS_REFRESHED_KEY = 'boards_refreshed_for_cycle';

export type BoardRefreshResult = {
  /** False when the cycle was already claimed, or when nothing is trading. */
  refreshed: boolean;
  /** Hatian counters brought forward. Zero unless this call won the claim. */
  kahatis: number;
  /** Campaign batches brought forward. Zero unless this call won the claim. */
  campaigns: number;
};

const NOTHING: BoardRefreshResult = { refreshed: false, kahatis: 0, campaigns: 0 };

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
 * Brings every listing nobody joined up to date, once per cycle.
 *
 * Called from the two board routes, after their sweeps and BEFORE their seeders:
 * a listing that exists is refreshed first, and only then does the seeder add
 * one for a product that genuinely has none. The other order would open a
 * correctly-priced listing and then have nothing left to refresh, which works by
 * accident and reads as though the order does not matter.
 *
 * A dark board does nothing at all. There is no cycle to key the claim on, and
 * claiming one anyway would spend the next cycle's refresh on a closed board.
 *
 * Only EMPTY listings move; refreshEmptyKahati and refreshEmptyCampaign guard
 * every write on that. A listing people are committed to is a running batch, and
 * only the admin cycle controls end one.
 */
export async function refreshBoardsForNewCycle(
  db: Db,
  now: Date = new Date(),
): Promise<BoardRefreshResult> {
  const cycle = await getCurrentCycle(now);
  if (!cycle) return NOTHING;

  if (!await claimCycle(db, cycleKeyOf(cycle))) return NOTHING;

  // Read after the claim is won, so the loser of a race does not spend two
  // queries fetching rows it will not touch.
  const counters = await db.select().from(groupBuys)
    .where(and(eq(groupBuys.status, 'open'), eq(groupBuys.claimedSlots, 0)));
  const batches = await db.select().from(moqCampaigns)
    .where(and(eq(moqCampaigns.status, 'open'), eq(moqCampaigns.committed, 0)));

  let kahatis = 0;
  let campaigns = 0;

  // Sequential and individually contained, for the reason rollOpenKahatis is:
  // the boards are tens of rows, and one listing whose product cannot be read
  // must not abort the reset for every other listing on the board.
  for (const counter of counters) {
    try {
      if (await refreshEmptyKahati(db, counter)) kahatis += 1;
    } catch {
      // Left as it was. The next cycle tries again, and the board is still
      // readable — which is the point of not letting this throw into a GET.
    }
  }
  for (const batch of batches) {
    try {
      if (await refreshEmptyCampaign(db, batch)) campaigns += 1;
    } catch {
      // As above.
    }
  }

  return { refreshed: true, kahatis, campaigns };
}
