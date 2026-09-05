// What we owe each customer when a Pasalo closes short — the arithmetic, with
// no database in sight.
//
// The trap this module exists to avoid is refunding money that was never
// collected. A hatian does NOT charge for the goods at checkout: it collects a
// DEPOSIT (under the default policy, the cycle's packing fee) and settles the
// vials afterwards, once the batch is confirmed (lib/settlement.ts). So at the
// moment a Pasalo closes, the overwhelmingly common state is a customer who has
// paid ₱150 and owes ₱4,000 — and sending them ₱4,000 back "for the failed
// product" would be paying out four thousand pesos that never came in.
//
// Everything here follows from that:
//
//   goods    are refundable only where the goods were actually paid for, which
//            means a settled order (or a legacy order that paid in full at
//            checkout, before the fee was ever deferred).
//   deposit  is refundable only when NOTHING the customer ordered in this batch
//            survived. The deposit pays to pack one parcel; if any of their
//            vials still ships, that parcel exists and the fee is earned.
//
// A failed line on an unsettled order therefore refunds ₱0 — correctly. The
// customer is not out of pocket; the line simply drops out of what they are
// billed. Saying so on the sheet is what stops an admin paying it twice.
import { round2 } from './pricing';
import { isGoodsCollected, type CollectedBasis } from './refund-status';

/** One kahati line in the batch being closed, and whether its counter failed. */
export type BatchLine = {
  orderItemId: string;
  orderId: string;
  userId: string;
  groupBuyId: string;
  /** order_items.line_total_php — what the customer was actually charged. */
  lineTotalPhp: number;
  qty: number;
  /** Decided by the counter's outcome, not by this line. */
  failed: boolean;
  /** The counter's closing sentence; null on a surviving line. */
  failureReason: string | null;
};

/** The payment state of one order in the batch, read before anything is cancelled. */
export type BatchOrderFacts = {
  orderId: string;
  userId: string;
  /** orders.downpayment_php — what was collected AT CHECKOUT. */
  downpaymentPhp: number;
  /** orders.packing_fee_php — with cycleKey, this identifies the fee generation. */
  packingFeePhp: number;
  cycleKey: string | null;
  paymentStatus: string;
  /** settlements.status, or null when the order has not been settled. */
  settlementStatus: string | null;
};

export type PasaloRefundRow = {
  orderItemId: string;
  orderId: string;
  userId: string;
  groupBuyId: string;
  goodsPhp: number;
  depositPhp: number;
  amountPhp: number;
  collectedBasis: CollectedBasis;
  reason: string;
};

/**
 * Which of this customer's payments had actually cleared.
 *
 * The middle branch is the one that matters and the one that is easy to get
 * wrong. Three generations of order meet here, exactly as they do in
 * lib/settlement.ts isReadyToSettle:
 *
 *   - a paid settlement means the balance cleared: the goods were paid for;
 *   - a fee on the row with NO cycle key is a pre-deferral order, paid in full
 *     at checkout, so 'confirmed' on it really does mean the goods were paid;
 *   - a cycle-era 'confirmed' proves only that the DEPOSIT was verified.
 *
 * Testing `paymentStatus === 'confirmed'` alone would put every cycle-era order
 * in the second bucket and refund the full vial price to every customer who has
 * so far paid ₱150.
 */
export function collectedBasisFor(o: BatchOrderFacts): CollectedBasis {
  if (o.settlementStatus === 'paid') return 'settlement_paid';
  // An unverified proof is not money. A screenshot an admin has not checked
  // cannot release a refund, or a forged one pays out twice.
  if (o.paymentStatus !== 'confirmed') return 'nothing_collected';
  if (o.cycleKey == null && o.packingFeePhp > 0) return 'payment_confirmed';
  return 'deposit_only';
}

/** Whether this order's CHECKOUT payment cleared, which is what a deposit is. */
const depositCleared = (o: BatchOrderFacts): boolean =>
  o.paymentStatus === 'confirmed' && o.downpaymentPhp > 0;

/**
 * Every refund the close of a Pasalo owes, one row per FAILED line.
 *
 * `lines` must be every kahati line in the batch, failed and surviving alike —
 * the surviving ones are what decide whether a customer's parcel still ships,
 * and therefore whether their deposit is owed back. Passing only the failed
 * lines would refund the packing fee of every customer who had a mixed result.
 *
 * A line whose order is not in `orders` is DROPPED rather than defaulted. An
 * unknown payment state could be anything, and both guesses move money.
 */
export function buildPasaloRefunds(
  lines: readonly BatchLine[],
  orders: readonly BatchOrderFacts[],
  policy: { refundable: boolean },
): PasaloRefundRow[] {
  const factsFor = new Map(orders.map((o) => [o.orderId, o]));
  const known = lines.filter((l) => factsFor.has(l.orderId));

  // Customers with at least one line still going ahead. Their parcel exists, so
  // the fee that pays to pack it stays earned. Scoped to the CUSTOMER rather
  // than to the order because the fee is charged once per trading cycle across
  // every order they place in it (lib/packing-cycle.ts) — a customer whose
  // fee-paying order failed but whose second order survived is still getting a
  // parcel, and refunding the fee would pack it for free.
  const stillShipping = new Set(known.filter((l) => !l.failed).map((l) => l.userId));

  // What each customer is owed in deposits, pooled across their orders in this
  // batch and spent once. A deposit is charged per ORDER but a customer may
  // hold several, and refunding per LINE would return it once per failed vial.
  const depositPool = new Map<string, number>();
  if (policy.refundable) {
    const counted = new Set<string>();
    for (const l of known) {
      if (!l.failed || stillShipping.has(l.userId) || counted.has(l.orderId)) continue;
      counted.add(l.orderId);
      const facts = factsFor.get(l.orderId)!;
      if (!depositCleared(facts)) continue;
      depositPool.set(l.userId, round2((depositPool.get(l.userId) ?? 0) + facts.downpaymentPhp));
    }
  }

  // Which line carries each customer's pooled deposit. Chosen by order item id
  // rather than by position, so the same batch exports the same sheet however
  // the rows arrived — the report has to be reproducible, and "whichever line
  // the query happened to return first" is not.
  const carrier = new Map<string, string>();
  for (const l of [...known].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId))) {
    if (!l.failed || !depositPool.has(l.userId) || carrier.has(l.userId)) continue;
    carrier.set(l.userId, l.orderItemId);
  }

  return known.filter((l) => l.failed).map((l): PasaloRefundRow => {
    const facts = factsFor.get(l.orderId)!;
    const collectedBasis = collectedBasisFor(facts);
    // Floored, because a corrupt or hand-edited line total must not become a
    // charge to the customer — and because the database CHECK behind this row
    // would reject it anyway, taking the whole close down with it.
    const goodsPhp = isGoodsCollected(collectedBasis) ? round2(Math.max(l.lineTotalPhp, 0)) : 0;
    const depositPhp = carrier.get(l.userId) === l.orderItemId
      ? (depositPool.get(l.userId) ?? 0)
      : 0;

    return {
      orderItemId: l.orderItemId,
      orderId: l.orderId,
      userId: l.userId,
      groupBuyId: l.groupBuyId,
      goodsPhp,
      depositPhp,
      amountPhp: round2(goodsPhp + depositPhp),
      collectedBasis,
      reason: l.failureReason ?? 'Batch did not reach its minimum after Pasalo closed.',
    };
  });
}

export type PasaloRefundTotals = {
  rows: number;
  customers: number;
  goodsPhp: number;
  depositPhp: number;
  totalPhp: number;
};

/** What the whole close adds up to, for the dashboard and the workbook's totals row. */
export function pasaloRefundTotals(rows: readonly PasaloRefundRow[]): PasaloRefundTotals {
  return {
    rows: rows.length,
    // Counted on distinct users, not on rows: one customer with four failed
    // lines is one person to pay, and "12 customers requiring refund" has to
    // mean twelve people.
    customers: new Set(rows.map((r) => r.userId)).size,
    goodsPhp: round2(rows.reduce((s, r) => s + r.goodsPhp, 0)),
    depositPhp: round2(rows.reduce((s, r) => s + r.depositPhp, 0)),
    totalPhp: round2(rows.reduce((s, r) => s + r.amountPhp, 0)),
  };
}
