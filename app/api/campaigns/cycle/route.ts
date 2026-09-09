import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb } from '@/lib/db';
import { rollOpenBatches } from '@/lib/moq-batch-server';

// Admin: start a new cycle across the whole board.
//
// Ends every running batch that has commitments and opens its successor inside
// the same series, so the batches that just closed archive under their group
// buy instead of being replaced by a hand-made campaign that starts a rival one.
//
// Batches nobody joined are not ended — there is nothing to end — but they ARE
// re-read from the catalog in place, so a cycle brings the board's terms forward
// even where it ends nothing. Such a batch blocked its own replacement, because
// the seeder will not list a product a live batch already carries.
//
// Both counts come back in the response, so the admin sees what was ended and
// what was merely brought forward. Customer order statuses are not read or
// written here: closing a batch is a campaign decision, and reconciling the
// orders inside it is the admin's, on the orders screen.
//
// Deliberately not gated behind the trading window: this is the control that
// ENDS a cycle, and an admin has to be able to reach it whether the boards are
// open or shut.
export const POST = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  const { rolled, skippedEmpty, refreshed } = await rollOpenBatches(db);
  return ok({
    rolled: rolled.length,
    skippedEmpty,
    // Of the empty ones, how many were brought forward from the catalog. See
    // lib/listing-sync.ts: an empty batch blocked its own replacement, so it
    // kept the terms it opened with until a cycle re-read them.
    refreshed,
    batches: rolled.map((r) => ({
      seriesId: r.opened.seriesId,
      name: r.opened.name,
      endedBatchNo: r.sealed.batchNo,
      endedWithKits: r.sealed.committed,
      openedBatchNo: r.opened.batchNo,
    })),
  });
});
