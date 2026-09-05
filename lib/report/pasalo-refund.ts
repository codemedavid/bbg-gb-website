// The refund report's four sheets, shaped from database records. Pure: no I/O,
// no clock, no ExcelJS.
//
// Split from the rendering for the reason every report in this folder is: the
// arithmetic that decides what a customer is owed has to be testable without a
// spreadsheet library, and the workbook has to be re-renderable without
// re-deciding anything.
//
// The rule that shapes all of it: a customer appears ONCE on the summary sheet
// however many failed lines and however many orders they hold. Consolidating
// per customer is the whole reason the sheet exists — an admin working a list
// that names Juan Dela Cruz three times sends three transfers.
import { round2 } from './money';
import type { CollectedBasis, RefundStatus } from '../refund-status';

/** One `order_item_refunds` row, joined to the customer and order that own it. */
export type RefundRecord = {
  id: string;
  orderItemId: string;
  orderId: string;
  orderNo: string;
  /** The counter this line failed on — how a refund joins its product. */
  groupBuyId: string | null;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** The delivery snapshot — who the parcel was actually for. */
  shipName: string;
  shipPhone: string;
  productName: string;
  qty: number;
  unitPricePhp: number;
  lineTotalPhp: number;
  goodsPhp: number;
  depositPhp: number;
  amountPhp: number;
  collectedBasis: CollectedBasis;
  reason: string;
  kahatiVials: number;
  pasaloVials: number;
  combinedVials: number;
  minRequired: number;
  status: RefundStatus;
  reference: string | null;
  method: string | null;
  refundAccount: string | null;
  refundedAt: Date | null;
  notes: string | null;
  /** orders.payment_method — the account the customer paid INTO, if recorded. */
  paymentMethod: string | null;
  orderedOn: string;
};

/** A surviving line belonging to a customer who appears in the refund list. */
export type SuccessfulItem = {
  userId: string;
  groupBuyId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  orderNo: string;
  orderItemId: string;
  productName: string;
  qty: number;
  unitPricePhp: number;
  lineTotalPhp: number;
  kahatiVials: number;
  pasaloVials: number;
  combinedVials: number;
  minRequired: number;
  fulfilmentStatus: string;
};

/** One counter in the batch, whatever became of it. */
export type CounterOutcome = {
  groupBuyId: string;
  productName: string;
  kahatiVials: number;
  pasaloVials: number;
  combinedVials: number;
  minRequired: number;
  maxVials: number;
  neededToQualify: number;
  slotsRemaining: number;
  status: string;
  /** Vials whose payment an admin has actually verified — the honesty column. */
  paymentConfirmedVials: number;
};

// ---- Sheet 1: one row per customer ---------------------------------------

export type CustomerRefundRow = {
  userId: string;
  // The refund rows this one row consolidates. The admin settles a customer
  // with ONE transfer, so the panel has to be able to mark every one of their
  // failed lines with that single reference — and the summary row is all it
  // has in hand. Ids rather than a count: a count cannot be PATCHed.
  refundIds: string[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** Every order of theirs that carries a failed line, comma-separated. */
  orderNos: string;
  paymentMethods: string;
  failedItems: number;
  /** What they paid that is relevant to this batch — failed and successful alike. */
  relevantPaidPhp: number;
  successfulPhp: number;
  goodsRefundPhp: number;
  depositRefundPhp: number;
  totalRefundPhp: number;
  status: RefundStatus;
  reference: string;
  refundAccount: string;
  refundedAt: Date | null;
  notes: string;
};

/**
 * The summary sheet: one row per person to pay.
 *
 * `status` is the LEAST settled of their rows. A customer with one refunded
 * line and one still pending has not been paid, and rolling that up to
 * "Refunded" is how the second half is never sent.
 */
export function buildCustomerRefundRows(
  refunds: readonly RefundRecord[],
  successful: readonly SuccessfulItem[],
): CustomerRefundRow[] {
  const byUser = new Map<string, RefundRecord[]>();
  for (const r of refunds) {
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  }

  const successByUser = new Map<string, number>();
  for (const s of successful) {
    successByUser.set(s.userId, round2((successByUser.get(s.userId) ?? 0) + s.lineTotalPhp));
  }

  return [...byUser.entries()].map(([userId, rows]) => {
    const first = rows[0];
    const goodsRefundPhp = round2(rows.reduce((sum, r) => sum + r.goodsPhp, 0));
    const depositRefundPhp = round2(rows.reduce((sum, r) => sum + r.depositPhp, 0));
    const successfulPhp = successByUser.get(userId) ?? 0;
    // What the failed lines were billed at, whether or not that money was
    // collected. Distinct from the refund: it is the "original relevant amount"
    // an admin reconciles against, and the gap between the two is exactly what
    // the customer had not yet paid.
    const failedBilledPhp = round2(rows.reduce((sum, r) => sum + r.lineTotalPhp, 0));

    return {
      userId,
      refundIds: rows.map((r) => r.id),
      customerName: first.shipName || first.customerName,
      customerEmail: first.customerEmail,
      customerPhone: first.shipPhone || first.customerPhone,
      orderNos: unique(rows.map((r) => r.orderNo)).join(', '),
      paymentMethods: unique(rows.flatMap((r) => (r.paymentMethod ? [r.paymentMethod] : []))).join(', '),
      failedItems: rows.length,
      relevantPaidPhp: round2(failedBilledPhp + successfulPhp),
      successfulPhp,
      goodsRefundPhp,
      depositRefundPhp,
      totalRefundPhp: round2(goodsRefundPhp + depositRefundPhp),
      status: leastSettled(rows.map((r) => r.status)),
      reference: unique(rows.flatMap((r) => (r.reference ? [r.reference] : []))).join(', '),
      refundAccount: unique(rows.flatMap((r) => (r.refundAccount ? [r.refundAccount] : []))).join(', '),
      // The earliest, so a partly-paid customer does not read as finished on
      // the strength of one transfer.
      refundedAt: rows.every((r) => r.refundedAt) ? earliest(rows.map((r) => r.refundedAt!)) : null,
      notes: unique(rows.flatMap((r) => (r.notes ? [r.notes] : []))).join(' · '),
    };
  }).sort((a, b) => a.customerName.localeCompare(b.customerName));
}

const unique = (xs: string[]): string[] => [...new Set(xs)];
const earliest = (ds: Date[]): Date => ds.reduce((a, b) => (a < b ? a : b));

// Worst-first, so a customer's row reads as the least finished of their lines.
const SETTLEMENT_RANK: Record<RefundStatus, number> = {
  failed: 0, pending: 1, processing: 2, refunded: 3,
};

function leastSettled(statuses: RefundStatus[]): RefundStatus {
  return statuses.reduce((worst, s) =>
    SETTLEMENT_RANK[s] < SETTLEMENT_RANK[worst] ? s : worst, statuses[0] ?? 'pending');
}

// ---- Sheet 4: the batch, product by product -------------------------------

export type BatchSummaryRow = CounterOutcome & {
  customersAffected: number;
  successfulValuePhp: number;
  refundValuePhp: number;
  outcome: 'SUCCESS' | 'FAILED';
};

export function buildBatchSummaryRows(
  counters: readonly CounterOutcome[],
  refunds: readonly RefundRecord[],
  successful: readonly SuccessfulItem[],
): BatchSummaryRow[] {
  return counters.map((c) => {
    // Joined on the counter id the refund row already carries. Matching on the
    // frozen vial figures instead would merge two products that happened to
    // fail at the same count, which on a board of near-identical counters is
    // not a remote possibility.
    const mine = refunds.filter((r) => r.groupBuyId === c.groupBuyId);
    const mineSuccess = successful.filter((s) => s.groupBuyId === c.groupBuyId);
    const failed = c.combinedVials < c.minRequired;
    return {
      ...c,
      customersAffected: new Set(mine.map((r) => r.userId)).size,
      successfulValuePhp: round2(mineSuccess.reduce((s, r) => s + r.lineTotalPhp, 0)),
      refundValuePhp: round2(mine.reduce((s, r) => s + r.amountPhp, 0)),
      outcome: failed ? 'FAILED' : 'SUCCESS',
    };
  });
}

export type BatchTotals = {
  products: number;
  successfulProducts: number;
  failedProducts: number;
  successfulValuePhp: number;
  refundValuePhp: number;
  customersRequiringRefund: number;
};

export function buildBatchTotals(
  rows: readonly BatchSummaryRow[],
  refunds: readonly RefundRecord[],
): BatchTotals {
  return {
    products: rows.length,
    successfulProducts: rows.filter((r) => r.outcome === 'SUCCESS').length,
    failedProducts: rows.filter((r) => r.outcome === 'FAILED').length,
    successfulValuePhp: round2(rows.reduce((s, r) => s + r.successfulValuePhp, 0)),
    // Summed from the REFUND rows, not from the per-product column: a customer
    // deposit is attached to one line and belongs to no single product, so
    // adding the product column would drop it.
    refundValuePhp: round2(refunds.reduce((s, r) => s + r.amountPhp, 0)),
    customersRequiringRefund: new Set(refunds.map((r) => r.userId)).size,
  };
}

/**
 * The file name, which is part of the deliverable: a folder of downloads called
 * "report.xlsx" is a folder nobody can reconcile.
 */
export function refundReportFilename(batchLabel: string, generatedAt: Date): string {
  const ymd = generatedAt.toISOString().slice(0, 10);
  const slug = batchLabel.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug
    ? `BBG-Refund-Report-${slug}-${ymd}.xlsx`
    : `BBG-Refund-Report-${ymd}.xlsx`;
}
