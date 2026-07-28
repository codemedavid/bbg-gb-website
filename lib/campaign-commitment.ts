// Group buy commitments a customer already holds — the rules, with no database
// in sight.
//
// The packing fee buys a PARCEL, not a commitment. A customer with an order
// still standing in a group buy has already paid to have that parcel packed, so
// ordering more from the same group buy joins the parcel they paid for and owes
// nothing further. Same shape as the kahati downpayment waiver in
// lib/kahati-commitment.ts, applied to the fee instead of the deposit.
//
// The waiver lapses when that parcel leaves: once the order ships (or is
// cancelled and refunded), the next commitment starts a fresh parcel and pays
// its own fee.
import type { OrderStatus } from './db/schema';

// One group buy line a customer holds, flattened from order -> order_item ->
// campaign batch. A commitment that overflowed into a successor batch
// contributes one entry per batch it claimed from, so `orderId` repeats.
export type CampaignCommitment = {
  orderId: string;
  orderNo: string;
  // The SERIES, not the batch. A batch that fills seals and opens a successor
  // carrying the same terms; to the customer that is one group buy they ordered
  // from twice, not two group buys — so the fee follows the series.
  seriesId: string;
  campaignName: string;
  orderStatus: OrderStatus;
  // What this order actually paid to have its parcel packed. Zero means the
  // order was itself waived (see below).
  packingFeePhp: number;
  qty: number;
  lineTotalPhp: number;
  placedAt: string;
};

// Order statuses that mean the parcel is no longer being assembled: it has left
// (shipped/delivered) or was refunded (cancelled). An order in any of these no
// longer holds a packed parcel the next commitment could join.
const PARCEL_CLOSED: readonly OrderStatus[] = ['shipped', 'delivered', 'cancelled'] as const;

// The series this customer has already paid a packing fee for.
//
// Two conditions, and both matter. The order must still be assembling — a
// shipped parcel is gone and the next one costs again. And it must have PAID a
// fee: an order that was itself waived carries ₱0, and letting it act as the
// source of a further waiver would chain the fee away forever (order #1 pays,
// #2 rides free, #1 ships, #3 rides on #2 — and nobody ever pays again).
export function seriesWithPaidPackingFee(
  commitments: readonly CampaignCommitment[],
): Set<string> {
  const paid = new Set<string>();
  for (const c of commitments) {
    if (PARCEL_CLOSED.includes(c.orderStatus)) continue;
    if (!(c.packingFeePhp > 0)) continue;
    paid.add(c.seriesId);
  }
  return paid;
}

// The packing fee a group buy line actually owes at checkout: the listing's fee,
// or nothing when this customer already has a parcel going in that series.
export function campaignPackingFeeDue(
  seriesId: string,
  listingFeePhp: number,
  paidSeriesIds: ReadonlySet<string>,
): number {
  return paidSeriesIds.has(seriesId) ? 0 : listingFeePhp;
}
