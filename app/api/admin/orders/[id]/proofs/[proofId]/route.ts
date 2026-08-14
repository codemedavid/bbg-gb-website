import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, orders, orderPaymentProofs } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireAdmin, ApiError } from '@/lib/session';
import { reconcileProofs } from '@/lib/proof-reconciliation';

// Both nullable, because clearing a figure typed by mistake has to be possible
// — an admin who cannot unset a wrong ₱2,000 will invent a compensating one.
const patchSchema = z.object({
  amountPhp: z.number().nonnegative().max(9_999_999).nullable().optional(),
  reference: z.string().trim().max(80).nullable().optional()
    .transform((v) => (v === '' ? null : v)),
});

type Ctx = { params: Promise<{ id: string; proofId: string }> };

/**
 * Record what one transfer was worth, and its bank reference.
 *
 * §13's arithmetic needs a home: a ₱4,500 order paid as ₱2,000 + ₱1,500 +
 * ₱1,000 can only be reconciled if each picture carries the figure it stands
 * for. The customer uploads the pictures; only someone reading the bank
 * statement can say which was which, so this is admin-only — what a payment was
 * worth is the shop's determination, not the payer's.
 *
 * Answers with the whole order's reconciliation rather than just the row it
 * changed, so the screen can show "₱3,500 of ₱4,500 — ₱1,000 short" without a
 * second request and without summing it client-side.
 */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id, proofId } = await ctx.params;
  const body = patchSchema.parse(await req.json());
  const db = await getDb();

  const [order] = await db.select({ totalPhp: orders.totalPhp }).from(orders).where(eq(orders.id, id));
  if (!order) throw new ApiError(404, 'Order not found.');

  // Matched on BOTH ids. Keying on the proof alone would let a mistyped order
  // id quietly edit a payment record belonging to a different customer.
  const [proof] = await db.select().from(orderPaymentProofs)
    .where(and(eq(orderPaymentProofs.id, proofId), eq(orderPaymentProofs.orderId, id)));
  if (!proof) throw new ApiError(404, 'Payment proof not found on this order.');

  const patch: { amountPhp?: string | null; reference?: string | null } = {};
  if (body.amountPhp !== undefined) patch.amountPhp = body.amountPhp == null ? null : String(body.amountPhp);
  if (body.reference !== undefined) patch.reference = body.reference ?? null;
  if (Object.keys(patch).length === 0) throw new ApiError(400, 'No fields to update.');

  await db.update(orderPaymentProofs).set(patch).where(eq(orderPaymentProofs.id, proofId));

  const proofs = await db.select().from(orderPaymentProofs)
    .where(eq(orderPaymentProofs.orderId, id))
    .orderBy(asc(orderPaymentProofs.sortOrder));

  return ok({
    proofs: proofs.map((p) => ({
      id: p.id, sortOrder: p.sortOrder, amountPhp: p.amountPhp, reference: p.reference,
    })),
    reconciliation: reconcileProofs(proofs, order.totalPhp),
  });
});
