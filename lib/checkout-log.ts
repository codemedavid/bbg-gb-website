// Structured diagnostics for the checkout path.
//
// Every defect in the September 2026 checkout audit had to be found by reading
// code and querying the production database, because this path emitted nothing
// at all. "How often does this happen", "which customers hit it" and "did the
// fix work" were unanswerable, so the ₱0 report and the disappearing-cart
// report stayed guesses far longer than they needed to.
//
// One line per event, prefixed and JSON-encoded so a hosting log drain can
// filter on it without a parser. console.info rather than a logging library
// because there is no logging library in this project and adding one is a
// bigger decision than this; console.error is already the established idiom for
// the two best-effort notification failures in POST /api/orders.

export const CHECKOUT_EVENTS = [
  'checkout_started',
  'checkout_validation_failed',
  'order_creation_started',
  'order_creation_failed',
  'order_created',
  'cart_cleared',
  'payment_proof_uploaded',
  'payment_status_changed',
  // The audit's own addition: a price that moved under a live cart is the one
  // failure whose frequency nobody could estimate, and it decides whether the
  // stale-quote guard is protecting customers or annoying them.
  'price_changed_mid_checkout',
  // The other end of the same story. A checkout takes money in; closing a
  // Pasalo decides what goes back out, and marking a refund records that it
  // did. An unexplained refund total six weeks later is answered from here.
  'pasalo_stage_closed',
  'refund_status_changed',
] as const;

export type CheckoutEvent = typeof CHECKOUT_EVENTS[number];

/**
 * The fields a checkout log line may carry.
 *
 * An allowlist rather than a denylist, and that direction is the whole design.
 * These lines leave the building. A caller spreading a request body into a log
 * call is a completely ordinary thing to do, and with a denylist every new field
 * on that body is a leak waiting to happen — with an allowlist it is silently
 * dropped, which is the safe default.
 *
 * So: no name, no phone, no address, no email, no token, no password, no
 * idempotency key. Identifiers, money and counts only.
 */
const ALLOWED_FIELDS = [
  'userId', 'orderId', 'orderNo', 'buyType', 'cycleKey',
  'status', 'paymentStatus', 'previousPaymentStatus',
  'itemCount', 'proofCount', 'splitCount',
  'totalPhp', 'subtotalPhp', 'packingFeePhp', 'downpaymentPhp',
  'quotedPhp', 'actualPhp',
  // Pasalo close and refund settlement. Counts and money, like everything else
  // here — who is owed is in the database, not in a log line that leaves the
  // building.
  'previousStatus', 'amountPhp', 'refundsWritten', 'refundTotalPhp',
  'customersOwed', 'ordersCancelled', 'fulfilledCounters', 'failedCounters',
  'httpStatus', 'reason', 'durationMs', 'attempt',
] as const;

export type CheckoutLogFields = Partial<Record<typeof ALLOWED_FIELDS[number], string | number | null>>;

export function checkoutLog(event: CheckoutEvent, fields: CheckoutLogFields = {}): void {
  try {
    const entry: Record<string, unknown> = { event, at: new Date().toISOString() };
    for (const key of ALLOWED_FIELDS) {
      const value = (fields as Record<string, unknown>)[key];
      // Primitives only. An object smuggled in under an allowed key could carry
      // anything, so it is dropped rather than serialised.
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' || typeof value === 'number') entry[key] = value;
    }
    console.info(`[checkout] ${JSON.stringify(entry)}`);
  } catch {
    // A logger must never be able to fail a checkout. Same lesson as the php()
    // ₱0 fallback, learned in the other direction: there, swallowing the
    // problem produced a wrong answer a customer could act on; here there is no
    // answer to get wrong, and the order matters more than the line about it.
  }
}
