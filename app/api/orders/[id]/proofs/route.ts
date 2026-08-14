import { asc, eq } from 'drizzle-orm';
import { getDb, orders, orderPaymentProofs, orderStatusHistory } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { validateAndStoreProofs } from '@/lib/proof';
import { acceptsMoreProofs } from '@/lib/order-status';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Attach one or more proofs of payment to an order that already exists.
 *
 * This is the second half of multi-proof: POST /api/orders takes the proofs the
 * customer holds at checkout, and this takes the ones that only exist later.
 * Without it, someone paying a ₱4,500 order as ₱2,000 now and ₱2,500 tomorrow
 * can never evidence the second transfer.
 *
 * The five-proof cap counts what the order ALREADY carries, so five visits of
 * one file each are refused on the sixth exactly as six at once are. Counted
 * inside the transaction, because two tabs submitting at the same moment would
 * otherwise both read four and both write.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const db = await getDb();

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw new ApiError(404, 'Order not found.');
  // Bank screenshots. Someone else's order is not a place to put one — and
  // unlike the GET beside this, an admin has no reason to upload on a
  // customer's behalf, so this is the owner alone.
  if (order.userId !== session.sub) throw new ApiError(403, 'Not your order.');

  // Same predicate the customer's screen uses to decide whether to offer the
  // uploader at all, so the two can never disagree about when it is allowed.
  if (!acceptsMoreProofs(order.status)) {
    throw new ApiError(400, order.status === 'cancelled'
      ? 'This order was cancelled, so no further payment is due.'
      : 'This order has already shipped — please contact us about any further payment.');
  }

  const form = await req.formData();
  const existing = await db.select({ sortOrder: orderPaymentProofs.sortOrder })
    .from(orderPaymentProofs).where(eq(orderPaymentProofs.orderId, id));

  // Validated and stored before the transaction opens, like checkout: uploading
  // is an external side effect, and a rolled-back insert leaves a harmless
  // orphaned object rather than a half-filed proof.
  const keys = await validateAndStoreProofs(form.getAll('proof'), { existingCount: existing.length });

  // Numbering continues from what is already filed. Restarting at 0 would give
  // one order two "Proof #1"s and leave the admin unable to say which
  // screenshot the customer meant.
  const nextIndex = existing.reduce((max, p) => Math.max(max, p.sortOrder + 1), 0);

  await db.transaction(async (tx) => {
    await tx.insert(orderPaymentProofs).values(keys.map((storageKey, i) => ({
      orderId: id, storageKey, sortOrder: nextIndex + i,
    })));
    // The order's status is deliberately NOT touched. Reverting a confirmed
    // order to proof_review would undo an admin's verification every time a
    // customer uploaded. The history row is how they learn of it instead —
    // without it a thumbnail simply appears and nobody knows when or why.
    await tx.insert(orderStatusHistory).values({
      orderId: id,
      status: order.status,
      note: keys.length === 1
        ? `Customer added proof #${nextIndex + 1}`
        : `Customer added proofs #${nextIndex + 1}–#${nextIndex + keys.length}`,
    });
  });

  const proofs = await db.select().from(orderPaymentProofs)
    .where(eq(orderPaymentProofs.orderId, id))
    .orderBy(asc(orderPaymentProofs.sortOrder));

  return ok({ added: keys.length, total: proofs.length }, 201);
});
