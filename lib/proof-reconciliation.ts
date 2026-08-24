// Reconciling several transfers against one order total — pure rule, no I/O.
//
// A ₱4,500 order paid as ₱2,000 + ₱1,500 + ₱1,000 is settled. The same three
// screenshots with only two amounts typed in is not evidence of anything yet,
// and the difference matters: one is an order to release, the other is an
// admin who has two rows left to check. Reading three thumbnails and a bank
// statement should not require doing the sum in your head.

/** The least a proof row must carry to be counted. */
export type ReconcilableProof = { amountPhp?: string | null };

export type ReconciliationState =
  /** No amount has been typed against any proof — nobody has looked yet. */
  | 'unrecorded'
  /** What is recorded falls short of the order total. */
  | 'short'
  /** Recorded amounts meet the total. */
  | 'settled'
  /** Recorded amounts exceed it — the customer is owed a refund. */
  | 'over';

export type Reconciliation = {
  recorded: number;
  /** total − recorded. Negative on an overpayment, so the sign carries meaning. */
  outstanding: number;
  state: ReconciliationState;
  /** Proofs still waiting for someone to type an amount against them. */
  unrecordedCount: number;
};

// Three ways of splitting ₱4,500 rarely divide evenly, and an order a tenth of
// a centavo short is settled by any reading a human would give it.
const CENTAVO_TOLERANCE = 0.01;

/** A stored amount as a number, or null if it is absent or junk. */
function amountOf(proof: ReconcilableProof): number | null {
  if (proof.amountPhp == null) return null;
  const n = Number(proof.amountPhp);
  // One NaN would otherwise turn the whole reconciliation into "NaN of ₱4,500".
  return Number.isFinite(n) ? n : null;
}

/**
 * Sum what the admin has attributed to each proof and compare it with the
 * order total.
 *
 * 'unrecorded' is deliberately distinct from 'short'. An order whose proofs
 * carry no amounts has not been checked; reporting it as "₱0 recorded, ₱4,500
 * outstanding" would put every fresh order into the same bucket as one that is
 * genuinely underpaid, and the admin would stop reading the bucket.
 */
export function reconcileProofs(
  proofs: readonly ReconcilableProof[],
  orderTotalPhp: string | number,
): Reconciliation {
  const amounts = proofs.map(amountOf);
  const recorded = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  const unrecordedCount = amounts.filter((a) => a == null).length;
  const total = Number(orderTotalPhp);
  const outstanding = Number.isFinite(total) ? total - recorded : 0;

  const state: ReconciliationState =
    amounts.every((a) => a == null) ? 'unrecorded'
    : outstanding > CENTAVO_TOLERANCE ? 'short'
    : outstanding < -CENTAVO_TOLERANCE ? 'over'
    : 'settled';

  return {
    recorded,
    // Snapped to zero inside the tolerance, so a settled order never renders a
    // stray "₱0.001 outstanding".
    outstanding: Math.abs(outstanding) <= CENTAVO_TOLERANCE ? 0 : outstanding,
    state,
    unrecordedCount,
  };
}

/** The order fields that decide what a proof is being checked against. */
export type ProofTargetOrder = {
  buyType?: string | null;
  totalPhp: string | number;
  downpaymentPhp?: string | number | null;
  /** Set once the balance has been collected at the final checkout. */
  settlementId?: string | null;
};

/**
 * What the proofs on this order are supposed to add up to RIGHT NOW.
 *
 * Not always the order total. A hatian commitment pays a downpayment while its
 * kit is still filling and settles the balance later, so checking its ₱500
 * deposit against a ₱1,950 total would report every correctly-paid commitment as
 * "₱1,450 short" — and an admin who sees that on every row stops reading the
 * line at all.
 *
 * Once the order has been settled the target goes back to the total: the
 * balance has been collected, and the order really is meant to add up in full.
 */
export function proofTargetPhp(order: ProofTargetOrder): number {
  const total = Number(order.totalPhp);
  const safeTotal = Number.isFinite(total) ? total : 0;
  if (order.buyType !== 'kahati' || order.settlementId) return safeTotal;
  const downpayment = Number(order.downpaymentPhp ?? 0);
  // A downpayment of zero is a commitment that owed nothing at checkout (the
  // cycle's fee was already paid), so there is nothing for a proof to match and
  // the total is the only meaningful figure left.
  if (!Number.isFinite(downpayment) || downpayment <= 0) return safeTotal;
  return Math.min(downpayment, safeTotal);
}

/**
 * Reconcile one order's proofs against what is due on it right now.
 *
 * The wrapper exists for a case the raw sum cannot see: a mixed cart splits into
 * several orders, and POST /api/orders writes EVERY proof onto EVERY one of them
 * — the customer paid one total and evidenced it once. So an admin recording
 * "₱3,150" against the single transfer behind a ₱1,950 hatian order and a ₱1,200
 * on-hand order is recording the truth, and that figure legitimately exceeds
 * either order's own due.
 *
 * Against a full order total that reads as 'over', which is conservative and
 * fine. Against a DEPOSIT it would read as "₱3,000 overpaid" and invite a refund
 * of money nobody overpaid — so excess over a deposit is reported as 'settled':
 * the deposit is covered, which is the only question this line is asking. A
 * genuine overpayment still surfaces when the sibling order is reviewed.
 */
export function reconcileOrderProofs(
  proofs: readonly ReconcilableProof[],
  order: ProofTargetOrder,
): Reconciliation & { target: number; isDeposit: boolean } {
  const target = proofTargetPhp(order);
  const total = Number(order.totalPhp);
  const isDeposit = Number.isFinite(total) && target < total;
  const r = reconcileProofs(proofs, target);
  if (!isDeposit || r.state !== 'over') return { ...r, target, isDeposit };
  // `recorded` is left exactly as typed — the admin must still see the figure
  // they entered, only not be told it is a refund.
  return { ...r, state: 'settled', outstanding: 0, target, isDeposit };
}
