// What is happening to the MONEY on an order, as opposed to what is happening
// to the parcel.
//
// `orders.status` (lib/order-status.ts) is the fulfilment flow: proof_review ->
// payment_confirmed -> batch_filling -> shipped -> delivered. Two of those five
// are statements about payment and three are statements about a parcel, and
// because one column carried both, a state the flow had no word for had to
// borrow one that meant something else.
//
// That is not hypothetical. A repeat kahati commitment genuinely owes ₱0 at
// checkout — the cycle's packing fee is already paid — and parking it in
// 'proof_review' would queue an admin review of a proof that does not exist.
// So checkout wrote 'payment_confirmed', which My Orders renders as "Payment
// Confirmed". 72 orders were born that way, ₱158,453.75 of goods between them
// and ₱0.00 actually collected; 38 carried no proof at all.
//
// The customer was told their payment was confirmed. It was not. Nobody had
// looked at anything, because there was nothing to look at.
//
// This module is the second field, and it only ever describes money. Pure and
// import-free on purpose, like lib/proof-limits.ts: the browser renders these
// labels and the routes enforce these transitions, so neither side may reach
// for a server module to get at them.

export const PAYMENT_STATUSES = [
  // Money is owed now and no evidence of it has arrived.
  'pending',
  // The customer has attached at least one proof. NOBODY HAS VERIFIED IT.
  // This is the state the client asked us to stop skipping: uploading a
  // screenshot is not the same event as an admin reading the bank statement.
  'proof_submitted',
  // An admin has checked the money actually arrived. The only state that means
  // "paid", and the only one a human can put an order into.
  'confirmed',
  // An admin looked and the payment was not good — wrong amount, wrong account,
  // unreadable, or never arrived.
  'rejected',
  // Nothing is payable at this moment. Distinct from 'confirmed' because no
  // payment happened, and distinct from 'pending' because none is being waited
  // for. A repeat kahati commitment in a cycle already paid for is here; so is
  // a cancelled order. The GOODS may still be owed — that is what the order
  // total and lib/settlement.ts are for — this field is only about what is
  // collectable today.
  'not_due',
] as const;

export type PaymentStatus = typeof PAYMENT_STATUSES[number];

/**
 * Customer-facing wording, one table shared by every screen.
 *
 * "No Payment Due" rather than anything with "confirmed" in it: the whole
 * defect was a customer reading a word that told them their money had been
 * received and checked when it had not been.
 */
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Payment Pending',
  proof_submitted: 'Proof Submitted',
  confirmed: 'Payment Confirmed',
  rejected: 'Payment Rejected',
  not_due: 'No Payment Due',
};

export const PAYMENT_STATUS_BADGE: Record<PaymentStatus, string> = {
  pending: 'bg-warn-bg text-warn-fg',
  proof_submitted: 'bg-[#e0eafc] text-brand-blue',
  confirmed: 'bg-[#e8f5db] text-brand-greendark',
  rejected: 'bg-[#f6e0e0] text-[#b23b3b]',
  not_due: 'bg-surface-mist text-ink-body',
};

/**
 * States that mean a human checked. Only an admin route may write these.
 *
 * Enforced rather than documented: checkoutPaymentStatus cannot return one, and
 * the admin route asserts membership before writing. A payment status the
 * customer's own request could set would be worth exactly nothing.
 */
const ADMIN_ONLY: readonly PaymentStatus[] = ['confirmed', 'rejected'];

export const isAdminOnlyPaymentStatus = (s: string): boolean =>
  (ADMIN_ONLY as readonly string[]).includes(s);

/** May we tell the customer their payment has been verified? */
export const isPaymentVerified = (s: string): boolean => s === 'confirmed';

/** Is this order still waiting on an admin to look at money? */
export const awaitsPaymentReview = (s: string): boolean => s === 'proof_submitted';

export const isPaymentStatus = (s: string): s is PaymentStatus =>
  (PAYMENT_STATUSES as readonly string[]).includes(s);

/**
 * The payment status a CHECKOUT may record.
 *
 * There is deliberately no path from here to 'confirmed' or 'rejected'. The
 * client sends a multipart body anyone can hand-build, so "the frontend should
 * never be able to set an order directly to payment_confirmed" has to be a
 * property of what this function can return, not a rule written down beside it.
 */
export function checkoutPaymentStatus(
  input: { nothingDue: boolean; proofCount: number },
): PaymentStatus {
  if (input.nothingDue) return 'not_due';
  return input.proofCount > 0 ? 'proof_submitted' : 'pending';
}

/**
 * The payment status of a row that may predate the column.
 *
 * Every order written before this existed carries only a fulfilment status and
 * whatever proofs it collected, so its payment state has to be inferred — once,
 * here, so the backfill migration and the runtime fallback cannot disagree.
 *
 * The load-bearing rule is the second one: a legacy order sitting at or past
 * 'payment_confirmed' with NO proof is not confirmed. Nobody verified it,
 * because there was nothing to verify — it is a confirm-only commitment, and
 * reading it as 'confirmed' would preserve the exact lie this module exists to
 * end. Those are the 24 live rows.
 */
export function derivePaymentStatus(
  order: { status: string; paymentStatus?: string | null; proofCount: number },
): PaymentStatus {
  // A stored value is an answer; never second-guess it with a derivation.
  if (order.paymentStatus && isPaymentStatus(order.paymentStatus)) return order.paymentStatus;

  // Nothing is collectable on a called-off order, whatever it carries.
  if (order.status === 'cancelled') return 'not_due';

  if (order.status === 'proof_review') {
    return order.proofCount > 0 ? 'proof_submitted' : 'pending';
  }

  if (['payment_confirmed', 'batch_filling', 'shipped', 'delivered'].includes(order.status)) {
    return order.proofCount > 0 ? 'confirmed' : 'not_due';
  }

  // A status this build has never heard of. Assume money is owed: the safe
  // direction is to ask a customer who has already paid, not to ship goods
  // against a payment nobody ever saw.
  return 'pending';
}
