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

  // A cancellation is a FULFILMENT fact, and letting it overwrite the payment
  // fact would be the same conflation this module exists to end. A cancelled
  // order the customer actually paid into is still paid into — and forgetting
  // that forgets a refund we owe. In production 19 cancelled orders carry a
  // proof and 10 hold deposits (₱1,500 between them).
  //
  // `orders.status` already says the order is off; this field is only asked
  // what became of the money.
  if (order.status === 'cancelled') {
    return order.proofCount > 0 ? 'confirmed' : 'not_due';
  }

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

/**
 * What one SETTLEMENT says about the money it carries, in this vocabulary.
 *
 * A hatian order is paid twice. The downpayment lands at checkout and is what
 * `orders.payment_status` records; the balance lands at the hatian final
 * checkout, which writes a settlement row and never touches that column. Asking
 * only the order therefore misses the larger of the two payments entirely.
 *
 * 'proof_review' maps to 'proof_submitted' rather than to 'pending' because a
 * settlement CANNOT exist without a proof — the route stores one before the
 * transaction opens (lib/proof.ts validateAndStoreProofs) — so the row itself
 * is the evidence that the customer sent money.
 *
 * A cancelled settlement collected nothing and so has nothing to say; the same
 * is true of a status this build has never heard of. Both return null, which
 * `overallPaymentStatus` reads as "this obligation does not speak".
 */
function settlementPaymentStatus(status: string | null | undefined): PaymentStatus | null {
  if (status === 'paid') return 'confirmed';
  if (status === 'proof_review') return 'proof_submitted';
  return null;
}

/**
 * How resolved each state is, worst first. Combining two payments takes the
 * MINIMUM, so the answer can never overstate what a customer has actually had
 * checked — 'rejected' first because a verdict against the money is the one
 * that most needs somebody to act.
 *
 * 'not_due' is absent on purpose: it is the identity, not a rank. It means this
 * obligation is carrying nothing, so it yields to any obligation that is.
 */
const RESOLUTION_ORDER: readonly PaymentStatus[] = [
  'rejected', 'pending', 'proof_submitted', 'confirmed',
];

const leastResolved = (a: PaymentStatus, b: PaymentStatus): PaymentStatus =>
  RESOLUTION_ORDER.indexOf(a) <= RESOLUTION_ORDER.indexOf(b) ? a : b;

/**
 * Everything this order's customer has paid into it — the checkout downpayment
 * AND the final-checkout settlement — as one state.
 *
 * This is what a customer-facing screen must ask. `derivePaymentStatus` answers
 * for the order row alone, which is right for the admin's payment queue and
 * wrong for My Orders: it is how KH-2791 came to show "No Payment Due" over a
 * PHP 1,140 payment made two days earlier, and how 20 other orders came to show
 * "Payment Confirmed" over a balance nobody had verified.
 *
 * The rule is the less resolved of the two, and it holds in both directions.
 * A paid settlement does not confirm a downpayment still owed; a verified
 * downpayment does not confirm a balance still in review.
 */
export function overallPaymentStatus(
  order: {
    status: string;
    paymentStatus?: string | null;
    proofCount: number;
    settlementStatus?: string | null;
  },
): PaymentStatus {
  const own = derivePaymentStatus(order);
  const settled = settlementPaymentStatus(order.settlementStatus);
  if (!settled) return own;
  // The order itself is carrying nothing, so the settlement is the whole story.
  if (own === 'not_due') return settled;
  return leastResolved(own, settled);
}
