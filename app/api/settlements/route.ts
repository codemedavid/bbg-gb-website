import { z } from 'zod';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { getDb, orders, paymentMethods, settlements, users } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { settlementTotals } from '@/lib/settlement';
import { readySettlementOrders, findReplayedSettlement } from '@/lib/settlement-server';
import { validateAndStoreProof } from '@/lib/proof';
import { sendEmail, settlementPlacedEmail } from '@/lib/email';
import { captureEvent } from '@/lib/posthog';

const settlementSchema = z.object({
  paymentMethod: z.string().min(1).max(40).optional(),
  // Client-minted once per submission and reused on retries, so a resubmitted
  // final checkout replays the original settlement instead of charging a
  // second packing fee.
  idempotencyKey: z.string().min(8).max(64).optional(),
});

// Customer: the hatian final checkout. Settles EVERY completed hatian order the
// customer still owes on, under one packing fee.
//
// The client sends payment details only — never a list of orders. The server
// picks the set, which is what makes "one fee per parcel" true no matter what a
// client sends, and stops a crafted request from settling someone else's orders
// or splitting its own into several fee-bearing checkouts.
export const POST = handler(async (req: Request) => {
  const session = await requireSession();
  const form = await req.formData();
  const body = settlementSchema.parse({
    paymentMethod: form.get('paymentMethod') ?? undefined,
    idempotencyKey: form.get('idempotencyKey') ?? undefined,
  });

  const db = await getDb();

  // A retry of an already-successful submission replays the original settlement.
  if (body.idempotencyKey) {
    const replayed = await findReplayedSettlement(db, session.sub, body.idempotencyKey);
    if (replayed) return ok({ settlement: replayed }, 201);
  }

  // Store the proof before opening the transaction — external side effect. A
  // rolled-back settlement leaves an orphaned object, which is harmless.
  const proofKey = await validateAndStoreProof(form.get('proof'));

  const settle = () => db.transaction(async (tx) => {
    // Reject a payment method the customer could not actually have chosen.
    if (body.paymentMethod) {
      const [m] = await tx.select({ id: paymentMethods.id }).from(paymentMethods)
        .where(and(eq(paymentMethods.label, body.paymentMethod), eq(paymentMethods.isActive, true)));
      if (!m) throw new ApiError(400, 'Selected payment method is not available.');
    }

    // Re-read inside the transaction; never trust a quote the client held onto.
    const ready = await readySettlementOrders(tx, session.sub);
    if (!ready.length) {
      throw new ApiError(400, 'You have no completed hatian orders to settle yet.');
    }
    const totals = settlementTotals(ready);

    const [settlement] = await tx.insert(settlements).values({
      userId: session.sub,
      status: 'proof_review',
      packingFeePhp: String(totals.packingFeePhp),
      balancePhp: String(totals.balancePhp),
      totalPhp: String(totals.totalPhp),
      paymentMethod: body.paymentMethod ?? null,
      paymentProofKey: proofKey,
      idempotencyKey: body.idempotencyKey ?? null,
    }).returning();

    // Claim the orders. The guard lives in the WHERE clause and RETURNING decides
    // what this settlement actually took, so two concurrent final checkouts
    // cannot both bill the same order — the loser claims fewer rows than it
    // priced and rolls back rather than charging a duplicate packing fee.
    //
    // An order held by a CANCELLED settlement is claimable again (that is what
    // cancelling means), but one held by a live settlement is never stolen.
    const ids = ready.map((o) => o.id);
    const cancelledSettlements = tx.select({ id: settlements.id }).from(settlements)
      .where(eq(settlements.status, 'cancelled'));
    const claimed = await tx.update(orders)
      .set({ settlementId: settlement.id, updatedAt: new Date() })
      .where(and(
        inArray(orders.id, ids),
        or(isNull(orders.settlementId), inArray(orders.settlementId, cancelledSettlements)),
      ))
      .returning({ id: orders.id });
    if (claimed.length !== ids.length) {
      throw new ApiError(409, 'Some of these orders were just settled — please refresh and try again.');
    }

    return { settlement, totals, orderCount: ids.length };
  });

  let created: Awaited<ReturnType<typeof settle>>;
  try {
    created = await settle();
  } catch (err) {
    // Two racing submissions of the same final checkout: the loser rolls back on
    // the unique idempotency key. If the winner's settlement exists, this IS that
    // race — replay it; anything else is a genuine failure and propagates.
    if (body.idempotencyKey) {
      const replayed = await findReplayedSettlement(db, session.sub, body.idempotencyKey);
      if (replayed) return ok({ settlement: replayed }, 201);
    }
    throw err;
  }

  // Notify only after the transaction commits — never announce a rolled-back
  // settlement. Greet the customer by name; the session carries only their email
  // address, and "Salamat, ana@example.com!" reads like a mailing-list blast.
  const [customer] = await db.select({ name: users.name })
    .from(users).where(eq(users.id, session.sub));
  await sendEmail({
    to: session.email,
    ...settlementPlacedEmail({
      name: customer?.name ?? session.email,
      orderCount: created.orderCount,
      balance: created.totals.balancePhp,
      packingFee: created.totals.packingFeePhp,
      total: created.totals.totalPhp,
    }),
    kind: 'settlement_placed',
  });
  await captureEvent({
    event: 'settlement_placed',
    distinctId: session.sub,
    email: session.email,
    // Same name the email above greets with — PostHog sends the real mail, so
    // omitting it here is what actually reaches the customer as a blast.
    name: customer?.name ?? undefined,
    properties: {
      settlementId: created.settlement.id,
      orderCount: created.orderCount,
      balancePhp: created.totals.balancePhp,
      packingFeePhp: created.totals.packingFeePhp,
      totalPhp: created.totals.totalPhp,
      paymentMethod: created.settlement.paymentMethod,
    },
  });

  return ok(created, 201);
});

// Customer: their own settlement history, newest first.
export const GET = handler(async () => {
  const session = await requireSession();
  const db = await getDb();
  const rows = await db.select().from(settlements)
    .where(eq(settlements.userId, session.sub))
    .orderBy(desc(settlements.createdAt));
  return ok(rows);
});
