import { pasaloScope } from '@/lib/pasalo-scope-server';
import { z } from 'zod';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb } from '@/lib/db';
import { openPasaloStage } from '@/lib/pasalo-server';
import { isValidYmd } from '@/lib/report/week';

// Opening Pasalo cancels below-minimum kits and opens only qualified incomplete kits.
const bodySchema = z.object({
  cycleKey: z.string().min(1).max(40).optional(),
  // The Pasalo deadline shown to customers. Optional and, on its own, not a
  // decision: passing it stops new commitments once it elapses, but what
  // happens to anybody's money is settled by POST ./close. A stage with no
  // deadline simply runs until the admin closes it.
  closesAt: z.string().datetime().nullable().optional(),
  // The batch being opened, as the Reports page has it. Optional and, when
  // absent, the whole board moves exactly as it always did — but the panel
  // always sends it, because a counter left behind by an earlier cycle is
  // otherwise dragged into this batch and refunded with it.
  from: z.string().refine(isValidYmd, 'Start date must be YYYY-MM-DD.').optional(),
  to: z.string().refine(isValidYmd, 'End date must be YYYY-MM-DD.').optional(),
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  // An empty body is a valid request — "open Pasalo, no deadline yet" — so a
  // missing or unparseable body must not be a 400.
  const raw = await req.json().catch(() => ({}));
  const { closesAt, from, to, cycleKey } = bodySchema.parse(raw ?? {});
  if (from && to && to < from) throw new ApiError(400, 'Batch end date must be on or after the start date.');

  const db = await getDb();
  const result = await openPasaloStage(db, {
    pasaloClosesAt: closesAt ? new Date(closesAt) : null,
    window: await pasaloScope(db, { from, to, cycleKey }),
  });

  return ok({
    opened: result.opened.length,
    cancelled: result.cancelled.length,
    cancelledCounterIds: result.cancelled,
    refundsWritten: result.refundsWritten,
    refundTotalPhp: result.refundTotalPhp,
    ordersCancelled: result.ordersCancelled,
    counterIds: result.opened,
    skippedEmpty: result.skippedEmpty,
    skippedFull: result.skippedFull,
    skippedOutOfRange: result.skippedOutOfRange,
  });
});
