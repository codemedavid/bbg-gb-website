import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, settlements, users } from '@/lib/db';
import { sendEmail, settlementConfirmedEmail } from '@/lib/email';

const schema = z.object({
  status: z.enum(['proof_review', 'paid', 'cancelled']),
  notes: z.string().max(500).optional(),
});

// Admin: verify or reject a hatian final checkout.
//
// 'paid' is the moment the customer's packing fee and final payment stop reading
// Unpaid. 'cancelled' releases the orders it was holding so the customer can
// settle them again — otherwise a mistaken confirmation would strand those
// orders as permanently settled-but-unpaid.
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = schema.parse(await req.json());

  const db = await getDb();
  const [existing] = await db.select().from(settlements).where(eq(settlements.id, id));
  if (!existing) throw new ApiError(404, 'Settlement not found.');

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(settlements).set({
      status: b.status,
      notes: b.notes ?? existing.notes,
      // Stamped on the transition into 'paid'; a re-confirm keeps the original
      // timestamp, and a cancel clears it so nothing reads as paid-and-cancelled.
      paidAt: b.status === 'paid' ? (existing.paidAt ?? new Date()) : null,
    }).where(eq(settlements.id, id)).returning();

    if (b.status === 'cancelled') {
      await tx.update(orders).set({ settlementId: null, updatedAt: new Date() })
        .where(eq(orders.settlementId, id));
    }
    return row;
  });

  // Tell the customer their final payment cleared — it is the last money they
  // owe on those hatians, so silence here reads as an unanswered payment.
  if (b.status === 'paid' && existing.status !== 'paid') {
    const [customer] = await db.select({ name: users.name, email: users.email })
      .from(users).where(eq(users.id, existing.userId));
    if (customer) {
      await sendEmail({
        to: customer.email,
        ...settlementConfirmedEmail({ name: customer.name, total: Number(existing.totalPhp) }),
        kind: 'settlement_confirmed',
      });
    }
  }

  return ok(updated);
});
