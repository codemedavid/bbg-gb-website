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
// Counters nobody joined are left running: there is nothing to end. So are
// counters an expiry has already condemned — the sweep owes those participants a
// refund, and sealing them would put that refund out of reach for good. Both
// numbers come back in the response so the admin can see the board was not wiped
// wholesale, and so can any counter whose roll failed. Customer order statuses are neither read nor written here — closing
// a counter is a board decision, and reconciling the orders inside it is the
// admin's, on the orders screen.
//
// Deliberately not gated behind the trading window: this is the control that
// ENDS a cycle, and an admin has to reach it whether the boards are open or shut.
export const POST = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  const { rolled, skippedEmpty, leftForCancellation, failed } = await rollOpenKahatis(db);
  return ok({
    rolled: rolled.length,
    skippedEmpty,
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
