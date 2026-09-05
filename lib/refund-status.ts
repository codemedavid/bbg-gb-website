// What became of a refund we owe, and what evidence decided the amount.
//
// Pure and import-free on purpose, like lib/payment-status.ts and
// lib/proof-limits.ts: the browser renders these labels and the routes enforce
// these transitions, so neither side may reach for a server module to get them.
//
// The rule this module exists to hold is a negative one. Exporting a
// spreadsheet is NOT a refund. A file leaving the building proves that somebody
// intends to send money, and nothing more — so every row leaves here saying
// PENDING however many times it is downloaded, and only an explicit admin
// action, naming a reference, can say otherwise.

export const REFUND_STATUSES = [
  // Decided and owed. Nobody has sent anything.
  'pending',
  // Someone is actively sending it — the state that stops two admins working
  // the same sheet from paying one customer twice.
  'processing',
  // The money went back. Terminal, and the only state that means paid.
  'refunded',
  // The transfer was attempted and did not land: wrong number, closed account,
  // returned. Distinct from 'pending' because it needs a human, not a queue.
  'failed',
] as const;

export type RefundStatus = typeof REFUND_STATUSES[number];

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  refunded: 'Refunded',
  failed: 'Failed',
};

export const REFUND_STATUS_BADGE: Record<RefundStatus, string> = {
  pending: 'bg-warn-bg text-warn-fg',
  processing: 'bg-[#e0eafc] text-brand-blue',
  refunded: 'bg-[#e8f5db] text-brand-greendark',
  failed: 'bg-[#f6e0e0] text-[#b23b3b]',
};

export const isRefundStatus = (s: string): s is RefundStatus =>
  (REFUND_STATUSES as readonly string[]).includes(s);

/** Has this money actually gone back? Only one status may answer yes. */
export const isRefundSettled = (s: string): boolean => s === 'refunded';

/**
 * Money still to send. 'failed' counts: the customer has not been paid, and a
 * failed transfer that dropped out of the outstanding total is a customer who
 * quietly never gets their money.
 */
export const isRefundOutstanding = (s: string): boolean =>
  s === 'pending' || s === 'processing' || s === 'failed';

/**
 * May this refund move to `next`?
 *
 * 'refunded' is terminal in one direction only: re-marking an already-refunded
 * row as refunded is refused rather than ignored, because the second click is
 * usually a second person working the same sheet — and the honest answer to
 * "should I send this again?" is no. Reopening one that was recorded in error
 * is allowed, since the alternative is an untrue record nobody can correct.
 */
export function canTransitionRefund(current: string, next: RefundStatus): boolean {
  if (!isRefundStatus(current)) return false;
  if (current === next) return false;
  return true;
}

/**
 * Which of the customer's payments had actually cleared when the stage closed —
 * the reason a refund is the line total, the deposit, or nothing at all.
 *
 * This is the part of the calculation that cannot be guessed. A hatian collects
 * a DEPOSIT at checkout and settles the goods only after the batch is
 * confirmed (lib/settlement.ts), so at Pasalo close most customers have paid
 * for the deposit and nothing else. Refunding a failed line's full price to
 * someone who never paid it would send out money that never came in; the
 * failed line simply drops out of what they are billed instead.
 */
export const COLLECTED_BASES = [
  // Their settlement is marked paid: the balance cleared, so the goods on this
  // line were genuinely paid for and the line total is owed back.
  'settlement_paid',
  // An admin verified this order's own payment. Same conclusion, different
  // evidence — the path a non-deferred order takes.
  'payment_confirmed',
  // Only the checkout deposit has cleared. The goods were never collected, so
  // nothing is owed on them; the deposit may still be owed (see depositPhp).
  'deposit_only',
  // Nothing of this customer's has cleared at all. There is no money to send
  // back, and the row exists to say so rather than to be silently absent.
  'nothing_collected',
] as const;

export type CollectedBasis = typeof COLLECTED_BASES[number];

export const COLLECTED_BASIS_LABEL: Record<CollectedBasis, string> = {
  settlement_paid: 'Settlement paid — goods collected',
  payment_confirmed: 'Payment confirmed — goods collected',
  deposit_only: 'Deposit only — goods never collected',
  nothing_collected: 'Nothing collected',
};

/** Were the GOODS on this line actually paid for? Only then are they refundable. */
export const isGoodsCollected = (basis: string): boolean =>
  basis === 'settlement_paid' || basis === 'payment_confirmed';
