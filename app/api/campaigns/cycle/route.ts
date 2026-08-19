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
// Batches nobody joined are left running — there is nothing to end — and their
// number comes back in the response so the admin sees the board was not touched
// wholesale. Customer order statuses are not read or written here: closing a
// batch is a campaign decision, and reconciling the orders inside it is the
// admin's, on the orders screen.
//
// Deliberately not gated behind the trading window: this is the control that
// ENDS a cycle, and an admin has to be able to reach it whether the boards are
// open or shut.
export const POST = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  const { rolled, skippedEmpty } = await rollOpenBatches(db);
  return ok({
    rolled: rolled.length,
    skippedEmpty,
    batches: rolled.map((r) => ({
      seriesId: r.opened.seriesId,
      name: r.opened.name,
      endedBatchNo: r.sealed.batchNo,
      endedWithKits: r.sealed.committed,
      openedBatchNo: r.opened.batchNo,
    })),
  });
});
