import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb } from '@/lib/db';
import { closePasaloStage } from '@/lib/pasalo-server';
import { checkoutLog } from '@/lib/checkout-log';

// Admin: close Pasalo (Bunuan) and decide every counter in it.
//
// This is the moment the batch's outcome becomes real. At or above its minimum
// a counter closes and goes on to fulfilment; below it, the counter is
// cancelled and its LINES become refund records — item by item, so a customer's
// successful products keep shipping while only the failed ones are paid back.
//
// A clock deliberately does not do this. There is no scheduler in this app, and
// the decision moves customers' money: a deadline stops new commitments, but a
// person closes the stage.
//
// Idempotent. The whole evaluation runs in one transaction and every refund is
// written against a UNIQUE order_item_id, so a double-click, a retry after a
// timeout or a second admin pressing the same button writes nothing further —
// `refundsWritten: 0` is the honest answer to "it already happened".
//
// It does NOT mark anything refunded. Deciding what is owed and recording that
// the money went back are separate acts, and only PATCH /api/admin/refunds/[id]
// can do the second.
export const POST = handler(async () => {
  const admin = await requireAdmin();
  const db = await getDb();

  const result = await closePasaloStage(db);

  // Money decisions belong in the same log as the checkout ones — this is the
  // other end of the same story, and an unexplained refund total six weeks
  // later is answered from here.
  checkoutLog('pasalo_stage_closed', {
    userId: admin.sub,
    fulfilledCounters: result.fulfilled.length,
    failedCounters: result.failed.length,
    refundsWritten: result.refundsWritten,
    refundTotalPhp: result.refundTotalPhp,
    customersOwed: result.customersOwed,
    ordersCancelled: result.ordersCancelled,
  });

  return ok({
    fulfilled: result.fulfilled.length,
    failed: result.failed.length,
    fulfilledCounterIds: result.fulfilled,
    failedCounterIds: result.failed,
    refundsWritten: result.refundsWritten,
    refundTotalPhp: result.refundTotalPhp,
    customersOwed: result.customersOwed,
    ordersCancelled: result.ordersCancelled,
  });
});
