// What one hatian batch adds up to, with no database and no React in sight.
//
// The admin reads this block to answer two questions the participant table
// cannot: how much of the kit is still sellable, and how much money the batch is
// actually worth. Both have a trap in them, and both traps are the reason this
// is a module and not a handful of reduces inside the panel:
//
//   - Gross income is vials x THIS counter's per-vial price, never the sum of
//     the orderBalancePhp column. An overflow commitment holds lines against two
//     counters and reports the whole order's balance under both, so summing that
//     column books the same peso twice.
//   - A cancelled order contributes nothing. Its money is not coming and its
//     vials must not be ordered from the supplier, so it drops out of both the
//     income and the reserved count while staying visible as a cancellation.
import { round2 } from './pricing';
import type { HatianCommitment } from './types';

// The summary reads a strict subset of a participant row, so it stays usable
// from a test, a report or a server route without dragging the whole feed
// contract — and any HatianCommitment satisfies it.
export type BatchCommitment = Pick<
  HatianCommitment,
  'orderId' | 'orderStatus' | 'vials' | 'orderBalancePhp' | 'spansOtherHatians'
  | 'downpayment' | 'finalPayment' | 'packingFee'
>;

export type HatianBatchSummary = {
  totalParticipants: number;
  totalVialsReserved: number;
  remainingVials: number;
  grossIncomePhp: number;
  confirmedPayments: number;
  pendingPayments: number;
  cancelledOrders: number;
};

type HatianTerms = {
  /** The counter's vial cap — one kit. */
  totalSlots: number;
  /** What one vial sells for on this counter. */
  perVialPhp: number;
};

const isCancelled = (c: Pick<BatchCommitment, 'orderStatus'>): boolean => c.orderStatus === 'cancelled';

// Fully settled: the reservation, the balance and the packing fee have all
// cleared. Anything short of that is money still being chased, including a proof
// sitting under review — "uploaded" is not "confirmed".
const isFullySettled = (c: BatchCommitment): boolean =>
  c.downpayment === 'paid' && c.finalPayment === 'paid' && c.packingFee === 'paid';

export function hatianBatchSummary(
  commitments: readonly BatchCommitment[],
  { totalSlots, perVialPhp }: HatianTerms,
): HatianBatchSummary {
  const live = commitments.filter((c) => !isCancelled(c));
  const totalVialsReserved = live.reduce((sum, c) => sum + c.vials, 0);
  const confirmedPayments = live.filter(isFullySettled).length;

  return {
    totalParticipants: commitments.length,
    totalVialsReserved,
    // Floors at zero: a legacy row over its cap would otherwise render a
    // negative "remaining", which reads as a bug rather than as a full kit.
    remainingVials: Math.max(0, totalSlots - totalVialsReserved),
    // Rounded once, at the end — per-row rounding of a fractional per-vial price
    // drifts by centavos across a full kit.
    grossIncomePhp: round2(totalVialsReserved * perVialPhp),
    confirmedPayments,
    pendingPayments: live.length - confirmedPayments,
    cancelledOrders: commitments.length - live.length,
  };
}
