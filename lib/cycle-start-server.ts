// Start a new cycle by hand — the one operation behind both admin "Start new
// cycle" buttons and scripts/start-cycle.ts.
//
// A cycle normally opens on the SCHEDULE, and lib/cycle-boundary-server.ts
// starts it on the first board read. This is the other way a cycle starts: an
// admin decides now is the time, whatever the calendar says. Until 2026-09-10
// the buttons only ROLLED the listings; with the schedule paused, every
// listing moved and customers still saw a closed board, orders could not be
// placed, and the fresh listings carried no cycle to be filed under.
//
// So a manual start is a schedule OVERRIDE, and it does everything a scheduled
// boundary does plus the two things a boundary never has to:
//
//   1. It opens the boards. A manual cycle window is written (lib/settings.ts
//      setManualCycle) and the resolver (lib/cycle-resolver.ts) lets the newer
//      cycle win, so the gate opens at once and the schedule takes over again
//      at its next opening.
//   2. It lifts any pause. A pause says "keep THIS cycle dark"; pressing Start
//      is the admin saying the opposite, and leaving the pause in force would
//      reproduce the bug this exists to fix.
//
// Then the same work the boundary does: claim the cycle so the next board read
// does not roll everything a second time, seal every joined listing and open
// its successor, bring the empties forward from the catalog, file everything
// still trading under the new cycle, and put every flagged product on both
// boards. BOTH boards, always: there is one cycle, and a hatian cycle that
// ended without the campaigns' one is the drift the shared schedule exists to
// prevent.
//
// Order of operations: the listings roll BEFORE the window opens. A roll that
// throws leaves the boards as they were — dark — rather than open on a board
// half moved; and a re-run after a failure is safe, because every step is
// idempotent against its own result.
import { getDb } from '@/lib/db';
import { rollOpenKahatis, type KahatiCycleRollover } from '@/lib/kahati-server';
import { rollOpenBatches, type CycleRollover } from '@/lib/moq-batch-server';
import { claimCycle, stampLiveListings } from '@/lib/cycle-boundary-server';
import { openKahatisForGroupBuyProducts } from '@/lib/kahati-seed-bulk';
import { openCampaignsForGroupBuyProducts } from '@/lib/campaign-seed-bulk';
import { getScheduleRecurrence, setManualCycle, setSchedulePausedUntil } from '@/lib/settings';
import { manualCycleFrom, cycleKeyOf } from '@/lib/cycle-resolver';
import type { Cycle } from '@/lib/schedule-recurrence';

type Db = Awaited<ReturnType<typeof getDb>>;

export type CycleStartResult = {
  /** The cycle that just opened. `cycleKey` is what its orders and listings file under. */
  cycle: Cycle & { cycleKey: string };
  kahati: KahatiCycleRollover & { coverage: Awaited<ReturnType<typeof openKahatisForGroupBuyProducts>> };
  campaigns: CycleRollover & { coverage: Awaited<ReturnType<typeof openCampaignsForGroupBuyProducts>> };
};

export async function startCycleNow(db: Db, now: Date = new Date()): Promise<CycleStartResult> {
  const cycle = manualCycleFrom(await getScheduleRecurrence(), now);
  const cycleKey = cycleKeyOf(cycle);

  const kahati = await rollOpenKahatis(db, now);
  const campaigns = await rollOpenBatches(db, now);
  await stampLiveListings(db, cycleKey);

  // The window opens only once the board it opens onto is ready — and it
  // opens, unpauses and is claimed in ONE transaction. Claimed under the new
  // key while the window was still unwritten, a board read racing this call
  // would resolve the OLD cycle, win a claim on its key, and re-stamp the
  // successors just opened under a cycle that has ended; a listing joined
  // before the next reconcile would then be filed there for good. Written
  // together, a racer sees either the old cycle (whose claim it cannot win
  // again) or the new one already claimed.
  await db.transaction(async (tx) => {
    await setManualCycle(cycle, tx);
    await setSchedulePausedUntil(null, tx);
    await claimCycle(tx, cycleKey);
  });

  const [kahatiCoverage, campaignCoverage] = [
    await openKahatisForGroupBuyProducts(),
    await openCampaignsForGroupBuyProducts(),
  ];
  // Seeded listings are this cycle's too. stampLiveListings only names rows
  // that carry no cycle or hold nothing, so this cannot re-file a joined one.
  await stampLiveListings(db, cycleKey);

  return {
    cycle: { ...cycle, cycleKey },
    kahati: { ...kahati, coverage: kahatiCoverage },
    campaigns: { ...campaigns, coverage: campaignCoverage },
  };
}
