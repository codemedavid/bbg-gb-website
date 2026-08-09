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
