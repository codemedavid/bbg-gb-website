// Hatian final checkout — the rules, with no database in sight.
//
// Committing to a hatian charges the downpayment only (see the deferral note in
// lib/pricing.ts). The packing fee is collected once, here, when the customer
// settles every hatian order that has completed. Joining ten hatians and
// settling them together is one fee, because it is one parcel.
//
// The database enforces the "once" — orders.settlement_id points at one
// settlement — and this module decides what goes into it and what each payment
// reads back as.
import { round2, settlementPackingFee } from './pricing';
import type { OrderStatus } from './db/schema';

// Hatian counters that are done accepting commitments and whose batch is being
// (or has been) fulfilled. 'open' is still filling; 'cancelled' took its orders
// down with it, so those orders are already cancelled and never settleable.
export const SETTLEABLE_GROUP_BUY_STATUSES = ['closed', 'shipped', 'completed'] as const;
export type SettleableGroupBuyStatus = typeof SETTLEABLE_GROUP_BUY_STATUSES[number];

export type SettlementStatus = 'proof_review' | 'paid' | 'cancelled';

// What a customer or admin sees against one payment obligation.
export type PaymentState = 'paid' | 'under_review' | 'unpaid' | 'cancelled';

export type SettleableOrder = {
  id: string;
  status: OrderStatus;
  totalPhp: number;
  downpaymentPhp: number;
  // What this order was charged for packing at commit time. 0 for every order
  // placed under the deferred rule; > 0 only for legacy orders placed before it.
  packingFeePhp: number;
  // The packing fee of the hatian this order committed to — the candidate fee
  // for the settlement, not something the order has paid.
  hatianPackingFeePhp: number;
  // The trading cycle this order was placed in, or null for an order placed
  // before cycles existed. Its presence is what distinguishes an order whose
  // packing fee was paid at checkout from a legacy one that paid at commit time
  // — the two carry the same fee on the row and mean opposite things.
  cycleKey: string | null;
  settlementId: string | null;
};

// An order is ready to settle when it is live, unsettled, placed under the
// deferred-fee rule, and EVERY hatian it claimed from has finished filling.
//
// The "every" matters for an overflow commitment that rolled into a sibling
// counter: it ships as one parcel, so settling it while the sibling is still
// open would bill a parcel that is not ready to go out.
//
// The packing-fee check is the cutover, and it turns on the CYCLE as well as
// the fee. Three generations of order meet here:
//
//   1. A fee with no cycle: placed before the fee was deferred, when balances
//      were collected off-platform and nothing recorded whether that had
//      happened. Quoting those would ask customers to pay a balance many of
//      them already settled in person, so they stay out of this flow entirely.
//   2. No fee and no cycle: placed while the fee was deferred to this final
//      checkout. Settled here, and the fee is collected here.
//   3. A cycle: placed under the per-cycle rule, which charges the fee at
//      checkout. Settled here, but the fee is NOT collected again.
//
// Testing the fee alone would put every generation-3 order in bucket 1 and make
// all of them permanently unsettleable.
export function isReadyToSettle(o: {
  status: OrderStatus;
  settlementId: string | null;
  settlementStatus?: SettlementStatus | null;
  groupBuyStatuses: string[];
  packingFeePhp?: number;
  cycleKey?: string | null;
}): boolean {
  if (o.status === 'cancelled') return false;
  // Held by a settlement — unless that settlement was cancelled, which frees the
  // order to be settled again while keeping the record of what it once covered.
  if (o.settlementId != null && o.settlementStatus !== 'cancelled') return false;
  if (o.cycleKey == null && (o.packingFeePhp ?? 0) > 0) return false;
  if (!o.groupBuyStatuses.length) return false;
  return o.groupBuyStatuses.every(
    (s) => (SETTLEABLE_GROUP_BUY_STATUSES as readonly string[]).includes(s),
  );
}

// What is still owed on one order. The order total itself already includes the
// checkout payment as an added fee line; subtracting here answers only "what is
// left to collect?" and prevents charging the already-paid amount again. Floors
// at zero so a downpayment larger than the order total never credits settlement.
export function orderBalance(o: Pick<SettleableOrder, 'totalPhp' | 'downpaymentPhp'>): number {
  return round2(Math.max(0, o.totalPhp - o.downpaymentPhp));
}

export type SettlementTotals = {
  balancePhp: number;
  packingFeePhp: number;
  totalPhp: number;
};

// What one final checkout costs: every outstanding balance, plus at most a
// single packing fee. Only generation-2 orders — no fee on the row AND no cycle
// — contribute a candidate fee. An order from either other generation already
// paid for its packing, and billing it again is exactly the double-charge this
// feature exists to remove.
export function settlementTotals(orders: SettleableOrder[]): SettlementTotals {
  const balancePhp = round2(orders.reduce((sum, o) => sum + orderBalance(o), 0));
  const deferredFees = orders
    .filter((o) => o.packingFeePhp <= 0 && o.cycleKey == null)
    .map((o) => o.hatianPackingFeePhp);
  const packingFeePhp = settlementPackingFee(deferredFees);
  return { balancePhp, packingFeePhp, totalPhp: round2(balancePhp + packingFeePhp) };
}

// The reservation payment made at commit time. It rides the order's own
// lifecycle: proof uploaded but unverified reads as under review.
export function downpaymentState(o: Pick<SettleableOrder, 'status'>): PaymentState {
  if (o.status === 'cancelled') return 'cancelled';
  return o.status === 'proof_review' ? 'under_review' : 'paid';
}

// The balance settled at the final checkout. A cancelled settlement releases its
// orders, so they read as unpaid again rather than staying stuck.
export function finalPaymentState(
  o: Pick<SettleableOrder, 'settlementId'>,
  settlementStatus: SettlementStatus | null,
): PaymentState {
  if (!o.settlementId || !settlementStatus || settlementStatus === 'cancelled') return 'unpaid';
  return settlementStatus === 'paid' ? 'paid' : 'under_review';
}

// The packing fee. An order that paid at commit time, and any order placed
// under the per-cycle rule (which collects the fee at checkout, or waives it
// because another order in the cycle already paid), is done. Only a deferred
// order's fee is settled with its balance.
export function packingFeeState(
  o: Pick<SettleableOrder, 'settlementId' | 'packingFeePhp' | 'cycleKey'>,
  settlementStatus: SettlementStatus | null,
): PaymentState {
  if (o.packingFeePhp > 0 || o.cycleKey != null) return 'paid';
  return finalPaymentState(o, settlementStatus);
}
