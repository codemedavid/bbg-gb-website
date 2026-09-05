import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orderItemRefunds } from '@/lib/db';
import { REFUND_STATUSES, canTransitionRefund, isRefundSettled, type RefundStatus } from '@/lib/refund-status';
import { checkoutLog } from '@/lib/checkout-log';

// Admin: record what actually happened to one refund.
//
// The only route in the system that may say money went back. Closing a Pasalo
// decides what is OWED; exporting a workbook prints it. Neither is evidence
// that a peso moved, and conflating the two is how a customer gets marked paid
// because somebody opened a spreadsheet.
//
// Marking one 'refunded' requires a reference. Not decoration: it is the only
// thing that lets a second admin, or the same admin next month, tell a transfer
// that happened from one somebody believed had.
const bodySchema = z.object({
  status: z.enum(REFUND_STATUSES as unknown as [string, ...string[]]),
  // The bank/GCash reference for the transfer. Required to settle one.
  reference: z.string().trim().max(80).optional(),
  method: z.string().trim().max(40).optional(),
  // Where it was sent. The customer's own account is stored nowhere else in
  // this system — payment_methods holds OUR accounts — so this is the record.
  refundAccount: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = bodySchema.parse(await req.json());
  const status = body.status as RefundStatus;

  const db = await getDb();
  const [current] = await db.select().from(orderItemRefunds).where(eq(orderItemRefunds.id, id));
  if (!current) throw new ApiError(404, 'Refund not found.');

  if (isRefundSettled(status) && !body.reference?.trim()) {
    throw new ApiError(400, 'A payment reference is required to mark a refund as refunded.');
  }

  // Re-sending is refused, not ignored. A second press of Mark Refunded is
  // almost always a second person working the same sheet, and the honest answer
  // to "should I send this again?" is no — so the request fails loudly with the
  // reference of the transfer that already went out, rather than quietly
  // succeeding and leaving two admins each believing they sent the money.
  if (!canTransitionRefund(current.status, status)) {
    throw new ApiError(409, isRefundSettled(current.status)
      ? `This refund was already marked refunded${current.reference ? ` (ref ${current.reference})` : ''}. Check before sending again.`
      : `This refund is already ${current.status}.`);
  }

  // Guarded on the status it was read at, so two admins working the same sheet
  // cannot both settle one refund — the loser is told, rather than silently
  // overwriting a transfer that already has a reference against it.
  const [updated] = await db.update(orderItemRefunds)
    .set({
      status,
      reference: body.reference ?? current.reference,
      method: body.method ?? current.method,
      refundAccount: body.refundAccount ?? current.refundAccount,
      notes: body.notes ?? current.notes,
      // Stamped only on the transition INTO refunded, and never cleared by a
      // later edit: when the money went back is a fact about the past.
      refundedAt: isRefundSettled(status) ? (current.refundedAt ?? new Date()) : current.refundedAt,
      refundedBy: isRefundSettled(status) ? (current.refundedBy ?? admin.sub) : current.refundedBy,
    })
    .where(and(eq(orderItemRefunds.id, id), eq(orderItemRefunds.status, current.status)))
    .returning();

  if (!updated) {
    throw new ApiError(409, 'This refund was updated by someone else — reload and check before sending again.');
  }

  if (updated.status !== current.status) {
    checkoutLog('refund_status_changed', {
      userId: admin.sub,
      orderId: current.orderId,
      previousStatus: current.status,
      status: updated.status,
      amountPhp: Number(updated.amountPhp),
    });
  }

  return ok(updated);
});
