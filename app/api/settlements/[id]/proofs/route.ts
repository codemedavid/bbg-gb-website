import { asc, eq } from 'drizzle-orm';
import { getDb, settlements, settlementPaymentProofs } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { validateAndStoreProofs } from '@/lib/proof';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Attach a proof of payment to a settlement already submitted.
 *
 * The mirror of POST /api/orders/[id]/proofs, and if anything the more needed
 * of the two: a settlement clears the balance on every hatian a customer joined
 * this cycle plus the packing fee, so it is the largest single amount they pay
 * and the one a bank's per-transfer cap is most likely to split across a day.
 *
 * Only while the settlement is still under review. Once the admin has marked it
 * paid it is verified and closed, and another screenshot against it is not a
 * payment — accepting one would suggest the customer still owes something.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const db = await getDb();

  const [settlement] = await db.select().from(settlements).where(eq(settlements.id, id));
  if (!settlement) throw new ApiError(404, 'Settlement not found.');
  if (settlement.userId !== session.sub) throw new ApiError(403, 'Not your settlement.');
  if (settlement.status !== 'proof_review') {
    throw new ApiError(400, settlement.status === 'paid'
      ? 'This final payment has already been verified.'
      : 'This final payment was cancelled.');
  }

  const form = await req.formData();
  const existing = await db.select({ sortOrder: settlementPaymentProofs.sortOrder })
    .from(settlementPaymentProofs).where(eq(settlementPaymentProofs.settlementId, id));

  const keys = await validateAndStoreProofs(form.getAll('proof'), { existingCount: existing.length });
  // Continues from what is filed, so "Proof #3" means the third transfer.
  const nextIndex = existing.reduce((max, p) => Math.max(max, p.sortOrder + 1), 0);

  await db.insert(settlementPaymentProofs).values(keys.map((storageKey, i) => ({
    settlementId: id, storageKey, sortOrder: nextIndex + i,
  })));

  const proofs = await db.select().from(settlementPaymentProofs)
    .where(eq(settlementPaymentProofs.settlementId, id))
    .orderBy(asc(settlementPaymentProofs.sortOrder));

  return ok({ added: keys.length, total: proofs.length }, 201);
});
