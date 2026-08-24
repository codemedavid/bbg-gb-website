import { z } from 'zod';
import { and, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import { getDb, orders, paymentMethods, settlements, settlementPaymentProofs, users } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { round2 } from '@/lib/pricing';
import { settlementTotals } from '@/lib/settlement';
import { readySettlementOrders, findReplayedSettlement } from '@/lib/settlement-server';
import { validateAndStoreProofs } from '@/lib/proof';
import { sendEmail, settlementPlacedEmail } from '@/lib/email';
import { captureEvent } from '@/lib/posthog';

const settlementSchema = z.object({
  paymentMethod: z.string().min(1).max(40).optional(),
  // Client-minted once per submission and reused on retries, so a resubmitted
  // final checkout replays the original settlement instead of charging a
  // second packing fee.
  idempotencyKey: z.string().min(8).max(64).optional(),
  // Which of the customer's ready orders to settle now. Absent means all of
  // them, which is what every client sent before the picker existed.
  orderIds: z.array(z.string().uuid()).optional(),
});

// The picker posts its selection as a JSON array in a multipart field. Malformed
// JSON is a bad request, not a reason to fall back to "settle everything" — that
// fallback would charge the customer for orders they had just deselected.
function parseOrderIds(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'Could not read which orders you selected. Please refresh and try again.');
  }
  if (!Array.isArray(parsed)) {
    throw new ApiError(400, 'Could not read which orders you selected. Please refresh and try again.');
  }
  // De-duplicated: the same id twice would make the count check fail against an
  // intersection that is correctly shorter.
  return [...new Set(parsed.map(String))];
}

// Has this customer already paid to have this parcel packed, through a
// settlement that is still standing? A cancelled settlement collected nothing,
// so it cannot be the reason a later one is free.
async function hasLiveSettlementFee(
  tx: Parameters<typeof readySettlementOrders>[0],
  userId: string,
): Promise<boolean> {
  const [row] = await tx.select({ id: settlements.id }).from(settlements)
    .where(and(
      eq(settlements.userId, userId),
      ne(settlements.status, 'cancelled'),
      gt(settlements.packingFeePhp, '0'),
    ))
    .limit(1);
  return !!row;
}

// Customer: the hatian final checkout. Settles the completed hatian orders the
// customer still owes on — by default all of them — under one packing fee.
//
// The client may now NARROW that set (client feedback: "option to delete or add
// some orders prior to proceeding checkout") but never widen it. The server
// still computes the eligible set itself and intersects the request with it, so
// a crafted list can only ever settle fewer of the sender's own orders — never
// someone else's, and never one that is not ready.
//
// Splitting the checkout must not split the fee into two. The parcel is packed
// once, so a customer who already has a live settlement carrying a packing fee
// pays none on the next one — see settlementPackingFeeDue.
export const POST = handler(async (req: Request) => {
  const session = await requireSession();
  const form = await req.formData();
  const rawOrderIds = form.get('orderIds');
  const body = settlementSchema.parse({
    paymentMethod: form.get('paymentMethod') ?? undefined,
    idempotencyKey: form.get('idempotencyKey') ?? undefined,
    // Absent and "[]" are different requests: the first says "settle
    // everything", the second names nothing and must not be read as the first.
    orderIds: rawOrderIds == null ? undefined : parseOrderIds(String(rawOrderIds)),
  });

  const db = await getDb();

  // A retry of an already-successful submission replays the original settlement.
  if (body.idempotencyKey) {
    const replayed = await findReplayedSettlement(db, session.sub, body.idempotencyKey);
    if (replayed) return ok({ settlement: replayed }, 201);
  }

  // Every proof the customer attached. A settlement is usually the largest
  // payment they make — every hatian's balance plus the packing fee — so it is
  // the one a bank's per-transfer cap is most likely to split in two or three.
  // Stored before the transaction opens (external side effect); a rolled-back
  // settlement leaves harmless orphaned objects.
  const proofKeys = await validateAndStoreProofs(form.getAll('proof'));

  const settle = () => db.transaction(async (tx) => {
    // Reject a payment method the customer could not actually have chosen.
    if (body.paymentMethod) {
      // Full-payment methods only: a settlement collects the BALANCE of
      // completed kits, and the hatian downpayment QR is a different account for
      // a different, already-paid obligation.
      const [m] = await tx.select({ id: paymentMethods.id }).from(paymentMethods)
        .where(and(
          eq(paymentMethods.label, body.paymentMethod),
          eq(paymentMethods.isActive, true),
          eq(paymentMethods.purpose, 'full'),
        ));
      if (!m) throw new ApiError(400, 'Selected payment method is not available.');
    }

    // Re-read inside the transaction; never trust a quote the client held onto.
    const all = await readySettlementOrders(tx, session.sub);
    if (!all.length) {
      throw new ApiError(400, 'You have no completed hatian orders to settle yet.');
    }

    // Intersect rather than look up: an id the customer does not own, or one
    // that is not ready, simply is not in `all` and so cannot be settled. The
    // count check then turns that silence into a refusal, because quietly
    // settling fewer orders than the customer asked for — and billing them for
    // it — is worse than failing.
    const selected = body.orderIds;
    const ready = selected ? all.filter((o) => selected.includes(o.id)) : all;
    if (selected && ready.length !== selected.length) {
      throw new ApiError(400, 'Some of the orders you selected are no longer ready to settle. Please refresh and try again.');
    }
    if (!ready.length) {
      throw new ApiError(400, 'Select at least one order to settle.');
    }

    // The parcel is packed once. A customer settling in instalments has already
    // paid for that with an earlier live settlement, so this one owes no fee.
    const quoted = settlementTotals(ready);
    const feeAlreadyPaid = await hasLiveSettlementFee(tx, session.sub);
    const packingFeePhp = feeAlreadyPaid ? 0 : quoted.packingFeePhp;
    const totals = {
      ...quoted,
      packingFeePhp,
      totalPhp: round2(quoted.balancePhp + packingFeePhp),
    };

    const [settlement] = await tx.insert(settlements).values({
      userId: session.sub,
      status: 'proof_review',
      packingFeePhp: String(totals.packingFeePhp),
      balancePhp: String(totals.balancePhp),
      totalPhp: String(totals.totalPhp),
      paymentMethod: body.paymentMethod ?? null,
      // The first proof, kept in the original column so the admin list and any
      // other reader of it keep working. The full set goes to
      // settlement_payment_proofs below.
      paymentProofKey: proofKeys[0] ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
    }).returning();

    // Every proof rides on the one settlement — three transfers are three
    // pieces of evidence for a single payment, never three settlements.
    await tx.insert(settlementPaymentProofs).values(proofKeys.map((storageKey, i) => ({
      settlementId: settlement.id, storageKey, sortOrder: i,
    })));

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
