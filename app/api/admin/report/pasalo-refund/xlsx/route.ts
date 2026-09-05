import { z } from 'zod';
import { requireAdmin, ApiError } from '@/lib/session';
import { handler } from '@/lib/api-response';
import { getDb } from '@/lib/db';
import { dateRangeBounds, isValidYmd } from '@/lib/report/week';
import { loadRefundReport } from '@/lib/report/pasalo-refund-server';
import {
  buildBatchSummaryRows, buildBatchTotals, buildCustomerRefundRows, refundReportFilename,
} from '@/lib/report/pasalo-refund';
import { buildRefundWorkbook } from '@/lib/report/pasalo-refund-xlsx';

// Admin: download the refund determination as a real .xlsx workbook.
//
// Built here rather than in the browser, unlike the weekly report. This file
// decides who gets money: the figures must be reproducible byte for byte, they
// must come from the database rather than from whatever a page happens to be
// holding, and ExcelJS's ~22MB has no business in an admin bundle. The browser
// only ever receives a file.
//
// Behind requireAdmin, and it carries names, phone numbers, email addresses and
// order history — so it is also marked no-store. A refund sheet sitting in a
// CDN or a shared browser cache is a customer list that leaked.
const querySchema = z.object({
  from: z.string().refine(isValidYmd, 'Start date must be YYYY-MM-DD.'),
  to: z.string().refine(isValidYmd, 'End date must be YYYY-MM-DD.'),
  batchLabel: z.string().max(60).optional(),
});

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const { from, to, batchLabel } = querySchema.parse({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    batchLabel: url.searchParams.get('batchLabel') ?? undefined,
  });
  if (to < from) throw new ApiError(400, 'Batch end date must be on or after the start date.');

  const db = await getDb();
  const { start, end } = dateRangeBounds(from, to);
  const { refunds, successful, counters } = await loadRefundReport(db, { start, end });

  // An empty workbook is worse than a refusal: it looks like a batch where
  // nobody was owed anything, which is a conclusion an admin might act on.
  if (!refunds.length) {
    throw new ApiError(404, 'No refunds were determined in that range. Close a Pasalo stage first.');
  }

  const generatedAt = new Date();
  const label = batchLabel?.trim() || `${from} to ${to}`;
  const batch = buildBatchSummaryRows(counters, refunds, successful);

  const workbook = await buildRefundWorkbook({
    batchLabel: label,
    generatedAt,
    customers: buildCustomerRefundRows(refunds, successful),
    refunds,
    successful,
    batch,
    totals: buildBatchTotals(batch, refunds),
  });

  const body = await workbook.xlsx.writeBuffer();
  const filename = refundReportFilename(label, generatedAt);

  return new Response(body as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Quoted, because the label can carry spaces once an admin names a batch.
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
