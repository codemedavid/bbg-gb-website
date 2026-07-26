import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, settlements, users } from '@/lib/db';
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

  // Cancelling releases the orders LOGICALLY, by status — the settlement_id
  // link stays put. Nulling it out instead would throw away the only record of
  // which orders this settlement covered, leaving a later re-confirm to guess
  // the set back from "everything this customer has not settled" and sweep in
  // orders it never paid for. Eligibility reads the status (lib/settlement.ts),
  // so a cancelled settlement's orders are quotable again either way.
  const [updated] = await db.update(settlements).set({
    status: b.status,
    notes: b.notes ?? existing.notes,
    // Stamped on the transition into 'paid'; a re-confirm keeps the original
    // timestamp, and any other status clears it so nothing reads as confirmed
    // when it is not.
    paidAt: b.status === 'paid' ? (existing.paidAt ?? new Date()) : null,
  }).where(eq(settlements.id, id)).returning();

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
