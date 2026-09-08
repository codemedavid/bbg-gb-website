import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb } from '@/lib/db';
import { dateRangeBounds, isValidYmd } from '@/lib/report/week';
import { loadPasaloBoard, loadRefundReport } from '@/lib/report/pasalo-refund-server';
import {
  buildBatchSummaryRows, buildBatchTotals, buildCustomerRefundRows,
} from '@/lib/report/pasalo-refund';

// Admin: the Pasalo refund determination, as the dashboard reads it.
//
// The same loader the workbook uses (lib/report/pasalo-refund-server.ts), so
// the screen and the file can never quote different totals — which is the way
// an admin ends up sending accounting a number nobody on the page recognises.
//
// Read-only. Downloading or viewing a refund determination never marks anything
// refunded; only PATCH /api/admin/refunds/[id] does that.
const querySchema = z.object({
  from: z.string().refine(isValidYmd, 'Start date must be YYYY-MM-DD.'),
  to: z.string().refine(isValidYmd, 'End date must be YYYY-MM-DD.'),
});

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const { from, to } = querySchema.parse({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  });

  const db = await getDb();
  const { start, end } = dateRangeBounds(from, to);
  const { refunds, successful, counters } = await loadRefundReport(db, { start, end });

  const batch = buildBatchSummaryRows(counters, refunds, successful);

  return ok({
    from,
    to,
    // The stage as it stands right now, which is a different question from what
    // a past close decided — the admin watches this table while Pasalo runs.
    board: await loadPasaloBoard(db, { start, end }),
    customers: buildCustomerRefundRows(refunds, successful),
    refunds,
    successful,
    batch,
    totals: buildBatchTotals(batch, refunds),
  });
});
