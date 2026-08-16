// May the customer still change this order themselves?
//
// Client feedback: "clients can edit yung added items na di pa nababayadan in
// full sa cart nila" — a customer should be able to fix an order they have not
// finished paying for, instead of messaging an admin to do it.
//
// "Not fully paid" is the whole rule, and it means different things on the two
// halves of the shop:
//
//   - On-hand and MOQ-shelf orders are paid in full at checkout. Once that
//     payment is CONFIRMED the money is in and the order is settled business;
//     while it is still under review nothing has cleared and it is fair game.
//   - Kahati and Group Buy orders pay only a packing-fee downpayment up front
//     and settle the balance later. They stay editable through payment_confirmed
//     because the balance genuinely is still outstanding.
//
// Two things end the window regardless. Once the batch is being FILLED the
// vials are physically being counted against this order, and once a live
// settlement has claimed it the amount has been quoted and paid against.
//
// Pure: no I/O. The route enforces ownership; this decides only the timing.
import type { SettlementStatus } from './settlement';

/** Fulfilment has started or finished — the commercial record is closed. */
const CLOSED_TO_EDITS = ['batch_filling', 'shipped', 'delivered', 'cancelled'] as const;

/** The boards that defer their balance to a final checkout. */
const DEFERRED_BOARDS = ['kahati', 'group_buy'] as const;

export type EditableOrder = {
  status: string;
  buyType: string;
  /** Set once a settlement has claimed the order; a cancelled one releases it. */
  settlementId?: string | null;
};

export type EditabilityReason =
  | 'editable'
  | 'fulfilment_started'
  | 'paid_in_full'
  | 'in_settlement';

/**
 * Why this order can or cannot be edited by its owner.
 *
 * Returns a reason rather than a boolean so the UI can say which of the three
 * doors closed — "your batch is being packed" and "you have already paid this"
 * are different messages, and a bare "cannot edit" invites a support message
 * that this feature exists to prevent.
 */
export function customerEditability(
  order: EditableOrder,
  settlementStatus: SettlementStatus | null = null,
): EditabilityReason {
  if ((CLOSED_TO_EDITS as readonly string[]).includes(order.status)) return 'fulfilment_started';
  // A cancelled settlement released its orders, so it locks nothing.
  if (order.settlementId && settlementStatus && settlementStatus !== 'cancelled') return 'in_settlement';
  const isDeferred = (DEFERRED_BOARDS as readonly string[]).includes(order.buyType);
  if (order.status === 'payment_confirmed' && !isDeferred) return 'paid_in_full';
  return 'editable';
}

export const isCustomerEditable = (
  order: EditableOrder,
  settlementStatus: SettlementStatus | null = null,
): boolean => customerEditability(order, settlementStatus) === 'editable';

/** What to tell the customer when the window has closed. */
export const EDIT_BLOCKED_MESSAGE: Record<Exclude<EditabilityReason, 'editable'>, string> = {
  fulfilment_started: 'This order is already being packed, so it can no longer be changed. Message us if something is wrong.',
  paid_in_full: 'This order is already paid in full, so it can no longer be changed. Message us if something is wrong.',
  in_settlement: 'This order is part of a final checkout you have already paid, so it can no longer be changed.',
};
