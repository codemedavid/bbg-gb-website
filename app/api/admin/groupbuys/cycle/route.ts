import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb } from '@/lib/db';
import { rollOpenKahatis } from '@/lib/kahati-server';

// Admin: start a new cycle across the whole hatian board.
//
// The mirror of POST /api/campaigns/cycle. Ends every open counter that has
// vials on it and opens its successor in the same breath, so the counters that
// just closed archive behind a fresh one instead of leaving the board — which is
// what pressing Close on each card in turn does.
//
// Counters nobody joined are not ended — there is nothing to end — but they ARE
// re-read from the catalog in place, and that is the other half of starting a
// cycle. Such a counter blocked its own replacement, because the seeder will not
// list a product that already carries an open one; left alone, it went on
// quoting the price it opened with for as long as it stayed listed.
//
// Counters an expiry has already condemned are the one case left untouched: the
// sweep owes those participants a refund, and sealing them would put that refund
// out of reach for good.
//
// Every count comes back in the response — ended, refreshed, left for
// cancellation, and any counter whose roll failed — so the admin can see what
// the cycle did rather than infer it. Customer order statuses are neither read
// nor written here: closing a counter is a board decision, and reconciling the
// orders inside it is the admin's, on the orders screen.
//
// Deliberately not gated behind the trading window: this is the control that
// ENDS a cycle, and an admin has to reach it whether the boards are open or shut.
export const POST = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  const { rolled, skippedEmpty, refreshed, leftForCancellation, failed } = await rollOpenKahatis(db);
  return ok({
    rolled: rolled.length,
    skippedEmpty,
    // Of the empty ones, how many the cycle brought forward from the catalog.
    // A board where nothing was joined still has work to report: those counters
    // were carrying the terms they opened with, and nothing else would have
    // corrected them — the seeder will not replace a product that already has
    // an open counter.
    refreshed,
    // Counters an expiry has already condemned: the sweep owes their
    // participants a refund, so the cycle steps around them rather than sealing
    // that refund away. Reported apart from the empty ones because the reason
    // they were skipped is entirely different.
    leftForCancellation,
    failed,
    counters: rolled.map((r) => ({
      id: r.opened.id,
      name: r.opened.name,
      endedCounterId: r.sealed.id,
      endedWithVials: r.sealed.claimedSlots,
    })),
  });
});
