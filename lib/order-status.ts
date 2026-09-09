// How an order's stored status is presented — one vocabulary, shared by My
// Orders, the order details page, the admin table and the status-change email.
//
// The labels are customer-facing on purpose. The enum is operational wording
// ('proof_review', 'batch_filling') aimed at whoever packs the parcel; a
// customer reading "Batch filling" on their own order has to guess what it
// means for them. Keeping ONE table rather than an admin set and a customer set
// is what stops the two screens from describing the same order differently.
//
// Nothing here stores state. Every label and every step is derived from the
// status the backend holds, so the two cannot drift apart.
import { ORDER_STATUS_FLOW } from '@/lib/db/schema';
import {
  PAYMENT_STATUS_BADGE, PAYMENT_STATUS_LABEL, overallPaymentStatus,
} from '@/lib/payment-status';

/** The fulfilment progression, in order. Mirrors the stored enum exactly. */
export const STATUS_FLOW = ORDER_STATUS_FLOW;

/** Cancellation sits outside the flow — see statusSteps below. */
export const CANCELLED_STATUS = 'cancelled';

export const STATUS_LABEL: Record<string, string> = {
  proof_review: 'Payment Pending',
  payment_confirmed: 'Payment Confirmed',
  batch_filling: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const STATUS_BADGE: Record<string, string> = {
  proof_review: 'bg-warn-bg text-warn-fg',
  payment_confirmed: 'bg-[#e0eafc] text-brand-blue',
  batch_filling: 'bg-[#e0eafc] text-brand-blue',
  shipped: 'bg-[#e0eafc] text-brand-blue',
  delivered: 'bg-[#e8f5db] text-brand-greendark',
  cancelled: 'bg-[#f6e0e0] text-[#b23b3b]',
};

/**
 * Where this status sits in the flow, or -1 for anything not in it.
 *
 * -1 covers both 'cancelled' and a value this build has never heard of — a
 * legacy row, or an enum extended on the server before the client redeployed.
 * Callers must not read -1 as "at the beginning": use statusSteps, which
 * distinguishes the two.
 */
export const statusIndex = (s: string): number => STATUS_FLOW.indexOf(s as never);

export const isCancelledStatus = (s: string): boolean => s === CANCELLED_STATUS;

export type StepState = 'done' | 'active' | 'pending';
export type StatusStep = { key: string; label: string; state: StepState };

/**
 * The fulfilment trail as it should be drawn for this status.
 *
 * A cancelled order is not "at step -1". Indexing it into the flow marked every
 * step not-yet-reached, which renders identically to a brand-new order — so the
 * screen told someone whose order had been called off that nothing had happened
 * yet. Here it yields an all-pending trail with NO active step, and callers ask
 * isCancelledStatus to say what actually became of it.
 *
 * An unrecognised status lands in the same all-pending shape, which is the
 * honest answer: we cannot place it, so we claim no progress rather than
 * guessing at "delivered".
 */
export function statusSteps(status: string): StatusStep[] {
  const current = statusIndex(status);
  return STATUS_FLOW.map((key, i) => ({
    key,
    label: STATUS_LABEL[key] ?? key,
    state: current < 0 ? 'pending' : i < current ? 'done' : i === current ? 'active' : 'pending',
  }));
}

/**
 * Statuses that still take money, and so still take evidence of it.
 *
 * A customer whose bank caps each transfer pays over hours or days, and may
 * also be asked to top up after an admin spots a shortfall — which can happen
 * once payment is confirmed or the batch is filling. All three are open orders
 * where another peso can legitimately arrive.
 *
 * Shipped and delivered are not: the parcel has gone, and accepting a proof
 * there tells the customer something was settled when nothing was. Cancelled
 * takes no money at all.
 *
 * Lives here, in the module both sides already import, so the screen that
 * offers the uploader and the route that accepts the upload cannot disagree
 * about when it is allowed.
 */
export const PROOF_ACCEPTING_STATUSES = ['proof_review', 'payment_confirmed', 'batch_filling'] as const;

/** May another proof of payment be attached to an order in this status? */
export const acceptsMoreProofs = (status: string): boolean =>
  (PROOF_ACCEPTING_STATUSES as readonly string[]).includes(status);

// ---------------------------------------------------------------------------
// The badge on the customer's own order
// ---------------------------------------------------------------------------

/**
 * The fulfilment states during which MONEY is the thing the customer is waiting
 * on. While an order is here, the badge speaks about payment; past here, the
 * parcel is the news and the payment verdict is history.
 *
 * 'payment_confirmed' is in this set precisely because it is the state that was
 * lying: as a fulfilment position it only means "cleared to proceed", and what
 * the customer needs to read off it is whether their money actually arrived.
 */
const PAYMENT_PHASE: readonly string[] = ['proof_review', 'payment_confirmed'];

export type OrderBadge = { label: string; className: string };

/**
 * What the customer's order list shows for this order.
 *
 * One function rather than a `STATUS_LABEL[...]` lookup at each call site,
 * because the answer now depends on two fields and a legacy fallback, and three
 * screens deciding that for themselves is how they end up describing the same
 * order differently — which is the class of bug this whole change is about.
 *
 * `proofCount` is only consulted for a row written before payment had a field
 * (see derivePaymentStatus); a row carrying paymentStatus never needs it.
 */
export function orderBadge(order: {
  status: string;
  paymentStatus?: string | null;
  proofCount?: number;
  settlementStatus?: string | null;
}): OrderBadge {
  // A called-off order is neither a payment state nor a delivery state. Said
  // first so nothing below can overrule it.
  if (isCancelledStatus(order.status)) {
    return { label: STATUS_LABEL.cancelled, className: STATUS_BADGE.cancelled };
  }

  if (PAYMENT_PHASE.includes(order.status)) {
    const payment = overallPaymentStatus({
      status: order.status,
      paymentStatus: order.paymentStatus ?? null,
      proofCount: order.proofCount ?? 0,
      settlementStatus: order.settlementStatus ?? null,
    });
    return { label: PAYMENT_STATUS_LABEL[payment], className: PAYMENT_STATUS_BADGE[payment] };
  }

  // Past the payment phase, or a status this build does not recognise. Falling
  // back to the raw value keeps an unknown state visible rather than rendering
  // an empty badge that reads as "no status at all".
  return {
    label: STATUS_LABEL[order.status] ?? order.status,
    className: STATUS_BADGE[order.status] || STATUS_BADGE.proof_review,
  };
}
