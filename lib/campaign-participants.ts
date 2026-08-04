// Who is in a Group Buy campaign, one row per customer — the rules, with no
// database in sight.
//
// The kahati board has had this view since lib/settlement.ts; group buy
// campaigns did not, which left Phase 6 of the QA plan unanswerable: an admin
// could see that a campaign held 4 kits but not who held them, and could not
// confirm the single-packing-fee guarantee that lib/campaign-commitment.ts
// makes at checkout.
//
// Grouping is by CUSTOMER, not by order. A customer ordering three times in one
// group buy is one participant with one parcel and one packing fee (see
// lib/campaign-commitment.ts) — showing them as three rows would read as three
// parcels and three fees owed.

/** One campaign order line as the database hands it over, before grouping. */
export type CampaignOrderRow = {
  orderId: string;
  orderNo: string;
  orderStatus: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  // The delivery snapshot taken at checkout, not the user's current profile: an
  // address edited later must not rewrite where a packed batch was shipped.
  shipPhone: string;
  shipAddress: string;
  /** Which batch of the series this line claimed from. */
  batchNo: number;
  /** Kits claimed from THIS batch by this order. */
  kits: number;
  lineTotalPhp: number;
  /** The whole ORDER's packing fee and total — repeated on every line it has. */
  packingFeePhp: number;
  totalPhp: number;
  paymentMethod: string | null;
  placedAt: string;
};

/** One order a participant placed, as the grouped row lists it. */
export type ParticipantOrder = {
  orderId: string;
  orderNo: string;
  orderStatus: string;
  kits: number;
  packingFeePhp: number;
  totalPhp: number;
  paymentMethod: string | null;
  placedAt: string;
  /** Batches of the series this one order claimed from, ascending. */
  batchNos: number[];
};

/** One customer in a campaign, with every order they placed in it. */
export type CampaignParticipant = {
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  shipPhone: string;
  shipAddress: string;
  /** Every kit this customer committed, across all their orders and batches. */
  kits: number;
  /** What they owe in total across those orders. */
  totalPhp: number;
  /**
   * The packing fee actually charged across the group buy. The guarantee is
   * that this equals ONE listing fee however many orders they placed.
   */
  packingFeePhp: number;
  /**
   * True when more than one of this customer's orders in this group buy carried
   * a fee — the defect the waiver exists to prevent. Surfaced rather than summed
   * away so an admin can see it and refund.
   */
  chargedPackingFeeTwice: boolean;
  orders: ParticipantOrder[];
  firstCommittedAt: string;
};

/**
 * Collapses campaign order lines into one row per customer.
 *
 * An order that overflowed into a successor batch appears once per batch. Kits
 * are summed across those lines, but the order's own figures — its packing fee
 * and total — are counted once, because they belong to the order, not the line.
 */
export function groupCampaignParticipants(
  rows: readonly CampaignOrderRow[],
): CampaignParticipant[] {
  const byUser = new Map<string, CampaignParticipant>();
  // Per user, the orders already folded in — so a second line of the same order
  // adds its kits without re-adding the order's fee and total.
  const seenOrders = new Map<string, Map<string, ParticipantOrder>>();

  for (const r of rows) {
    let p = byUser.get(r.userId);
    if (!p) {
      p = {
        userId: r.userId,
        customerName: r.customerName,
        customerEmail: r.customerEmail,
        customerPhone: r.customerPhone,
        shipPhone: r.shipPhone,
        shipAddress: r.shipAddress,
        kits: 0,
        totalPhp: 0,
        packingFeePhp: 0,
        chargedPackingFeeTwice: false,
        orders: [],
        firstCommittedAt: r.placedAt,
      };
      byUser.set(r.userId, p);
      seenOrders.set(r.userId, new Map());
    }

    const orders = seenOrders.get(r.userId)!;
    const existing = orders.get(r.orderId);

    if (existing) {
      // Another batch of the same order: kits only.
      existing.kits += r.kits;
      if (!existing.batchNos.includes(r.batchNo)) existing.batchNos.push(r.batchNo);
      p.kits += r.kits;
      continue;
    }

    const order: ParticipantOrder = {
      orderId: r.orderId,
      orderNo: r.orderNo,
      orderStatus: r.orderStatus,
      kits: r.kits,
      packingFeePhp: r.packingFeePhp,
      totalPhp: r.totalPhp,
      paymentMethod: r.paymentMethod,
      placedAt: r.placedAt,
      batchNos: [r.batchNo],
    };
    orders.set(r.orderId, order);
    p.orders.push(order);

    p.kits += r.kits;
    p.totalPhp += r.totalPhp;
    p.packingFeePhp += r.packingFeePhp;
    if (r.placedAt < p.firstCommittedAt) p.firstCommittedAt = r.placedAt;
  }

  for (const p of byUser.values()) {
    p.chargedPackingFeeTwice = p.orders.filter((o) => o.packingFeePhp > 0).length > 1;
    p.orders.forEach((o) => o.batchNos.sort((a, b) => a - b));
  }

  return [...byUser.values()].sort((a, b) => a.firstCommittedAt.localeCompare(b.firstCommittedAt));
}

/** Campaign-wide totals the admin header shows above the participant table. */
export function summariseCampaignParticipants(participants: readonly CampaignParticipant[]) {
  return {
    participantCount: participants.length,
    kits: participants.reduce((s, p) => s + p.kits, 0),
    totalPhp: participants.reduce((s, p) => s + p.totalPhp, 0),
    packingFeesPhp: participants.reduce((s, p) => s + p.packingFeePhp, 0),
    // Non-zero means the single-fee guarantee was broken for someone.
    doubleChargedCount: participants.filter((p) => p.chargedPackingFeeTwice).length,
  };
}
