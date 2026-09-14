// Hatian balances paid through the wrong door — database side.
//
// Before the order uploader refused them (app/api/orders/[id]/proofs), a
// customer whose hatians had all closed could attach their balance screenshot
// to the ORDER. Only a settlement clears a balance, so My Orders kept asking for
// money already sent and the admin Settlements queue never saw the payment.
//
// This finds those orders and files each customer's lot as ONE settlement
// awaiting review. It never marks one paid: the screenshots carry no amount,
// and an admin approves them in the Settlements screen like any other payment.
//
// Readiness is read through readySettlementOrders, the query the "ready to
// settle" prompt and the final checkout use, so this cannot file an order the
// customer could not have settled themselves.
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { orders, orderPaymentProofs, settlements, settlementPaymentProofs } from '@/lib/db';
import type { getDb } from '@/lib/db';
import { orderBalance, settlementTotals } from './settlement';
import { readySettlementOrders, type ReadyOrder } from './settlement-server';

type Db = Awaited<ReturnType<typeof getDb>>;

// Checkout files its proofs in the same request as the order, seconds apart at
// most. Ten minutes leaves room for a slow upload without mistaking a payment
// sent later for one made at checkout.
export const LATE_PROOF_AFTER_MS = 10 * 60 * 1000;

export type BalanceProofCandidate = {
  orderId: string;
  orderNo: string;
  userId: string;
  balancePhp: number;
  /** Storage keys of the proofs attached after checkout, in filing order. */
  lateProofKeys: string[];
};

export type RecordedSettlement = { settlementId: string; userId: string; orderNos: string[] };

type Candidate = BalanceProofCandidate & { ready: ReadyOrder };

async function collectCandidates(db: Db): Promise<Candidate[]> {
  const proofs = await db.select({
    orderId: orders.id,
    orderNo: orders.orderNo,
    userId: orders.userId,
    placedAt: orders.createdAt,
    storageKey: orderPaymentProofs.storageKey,
    uploadedAt: orderPaymentProofs.uploadedAt,
  })
    .from(orderPaymentProofs)
    .innerJoin(orders, eq(orders.id, orderPaymentProofs.orderId))
    .orderBy(orders.orderNo, orderPaymentProofs.sortOrder);

  // Compared in JS rather than as SQL interval arithmetic: tests run on PGlite
  // and prod on postgres-js, and a one-off repair is the last place to find out
  // the two bind an interval differently.
  const lateByOrder = new Map<string, { orderNo: string; userId: string; keys: string[] }>();
  for (const p of proofs) {
    if (p.uploadedAt.getTime() - p.placedAt.getTime() <= LATE_PROOF_AFTER_MS) continue;
    const entry = lateByOrder.get(p.orderId) ?? { orderNo: p.orderNo, userId: p.userId, keys: [] };
    lateByOrder.set(p.orderId, { ...entry, keys: [...entry.keys, p.storageKey] });
  }

  const userIds = [...new Set([...lateByOrder.values()].map((e) => e.userId))];
  const candidates: Candidate[] = [];
  for (const userId of userIds) {
    for (const ready of await readySettlementOrders(db, userId)) {
      const late = lateByOrder.get(ready.id);
      if (!late) continue;
      candidates.push({
        orderId: ready.id, orderNo: late.orderNo, userId,
        balancePhp: orderBalance(ready), lateProofKeys: late.keys, ready,
      });
    }
  }
  return candidates.sort((a, b) => a.orderNo.localeCompare(b.orderNo));
}

/** Every hatian ready to settle that carries a screenshot sent after checkout. */
export async function findBalanceProofOrders(db: Db): Promise<BalanceProofCandidate[]> {
  return (await collectCandidates(db)).map(({ ready: _ready, ...candidate }) => candidate);
}

/**
 * Files the named orders as settlements awaiting review, one per customer.
 *
 * Every order number must be a current candidate. One that is not — mistyped,
 * already settled, or not yet due — stops the run before anything is written:
 * these numbers are typed by a person, and skipping one quietly would leave a
 * customer still being asked for money while the operator believes it is done.
 */
export async function recordBalanceProofSettlements(db: Db, orderNos: string[]): Promise<RecordedSettlement[]> {
  const byNo = new Map((await collectCandidates(db)).map((c) => [c.orderNo, c]));
  const unknown = orderNos.filter((n) => !byNo.has(n));
  if (unknown.length) {
    throw new Error(`Not a hatian balance waiting on a settlement: ${unknown.join(', ')}`);
  }

  const byUser = new Map<string, Candidate[]>();
  for (const no of new Set(orderNos)) {
    const c = byNo.get(no)!;
    byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
  }

  return db.transaction(async (tx) => {
    const recorded: RecordedSettlement[] = [];
    for (const [userId, lot] of byUser) {
      const totals = settlementTotals(lot.map((c) => c.ready));
      const keys = lot.flatMap((c) => c.lateProofKeys);
      const ids = lot.map((c) => c.orderId);
      const nos = lot.map((c) => c.orderNo);

      const [settlement] = await tx.insert(settlements).values({
        userId,
        status: 'proof_review',
        packingFeePhp: String(totals.packingFeePhp),
        balancePhp: String(totals.balancePhp),
        totalPhp: String(totals.totalPhp),
        paymentProofKey: keys[0],
        notes: `Recorded from balance proofs attached to ${nos.join(', ')} outside Settle now. Check the amounts before approving.`,
      }).returning();

      await tx.insert(settlementPaymentProofs).values(keys.map((storageKey, i) => ({
        settlementId: settlement.id, storageKey, sortOrder: i,
      })));

      // The same claim guard as the final checkout: an order held by a live
      // settlement is not taken, and a short claim rolls the whole run back.
      const cancelled = tx.select({ id: settlements.id }).from(settlements).where(eq(settlements.status, 'cancelled'));
      const claimed = await tx.update(orders)
        .set({ settlementId: settlement.id, updatedAt: new Date() })
        .where(and(inArray(orders.id, ids), or(isNull(orders.settlementId), inArray(orders.settlementId, cancelled))))
        .returning({ id: orders.id });
      if (claimed.length !== ids.length) {
        throw new Error(`Some of ${nos.join(', ')} were settled while this ran — nothing was written.`);
      }

      recorded.push({ settlementId: settlement.id, userId, orderNos: nos });
    }
    return recorded;
  });
}
