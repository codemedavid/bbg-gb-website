// One packing fee per trading cycle — the rules, with no database in sight.
//
// The fee buys a PARCEL, and a cycle produces one parcel: everything a customer
// orders from Group Buy and Hatian between one opening and the next is packed
// and shipped together. So the fee is charged once per cycle, across BOTH
// boards, however many hatians and campaigns they joined.
//
// This replaces two narrower rules that each answered part of the question — one
// waiver per campaign series (lib/campaign-commitment.ts) and one deposit per
// open hatian (lib/kahati-commitment.ts). Both could fire in the same week, so a
// customer who joined a hatian AND a group buy paid to have one parcel packed
// twice. One rule, one question, one answer.
//
// The rows this reads are fetched by lib/packing-cycle-server.ts, and both the
// checkout and the screen that previews it call through it — so the fee a
// customer is shown is produced by the same query that decides what they pay.
import { round2 } from './pricing';
import type { OrderStatus } from './db/schema';

/** One order the customer placed in the cycle being asked about. */
export type CyclePayment = {
  orderStatus: OrderStatus;
  /** What that order actually paid to have the cycle's parcel packed. */
  packingFeePhp: number;
};

/**
 * Has this customer already paid to have this cycle's parcel packed?
 *
 * Two conditions, and both matter. The order must not be CANCELLED — a
 * cancelled order was refunded, so nothing was paid. And it must have PAID a
 * fee: an order that was itself waived carries ₱0, and letting it act as the
 * source of a further waiver would chain the fee away forever (order #1 pays,
 * #2 rides free on it, #3 rides on #2, and nobody ever pays again).
 *
 * A shipped order still counts, unlike the per-parcel rule this replaces. A
 * cycle is a fixed period: the customer paid to have this cycle's goods packed,
 * and an early shipment is not a reason to charge them for it twice.
 */
export function hasPaidPackingFeeThisCycle(payments: readonly CyclePayment[]): boolean {
  return payments.some((p) => p.orderStatus !== 'cancelled' && p.packingFeePhp > 0);
}

/**
 * The packing fee an order owes: the listing's fee, or nothing when this cycle
 * is already paid for. Floored at zero so a misconfigured listing can never
 * credit the order rather than charge it.
 */
export function packingFeeDueThisCycle(listingFeePhp: number, alreadyPaid: boolean): number {
  if (alreadyPaid) return 0;
  if (!Number.isFinite(listingFeePhp) || listingFeePhp <= 0) return 0;
  return round2(listingFeePhp);
}

// Kinds that belong to the scheduled boards, and therefore to a cycle. On-hand
// and MOQ-shelf lines ship as their own parcels on their own timing.
const CYCLE_KINDS: readonly string[] = ['group_buy', 'moq_campaign'] as const;

type Feeable = { kind: string; packingFeePhp?: number };

/**
 * One cycle fee across a whole cart.
 *
 * A cart spanning both boards splits into one order per mode, and packingFeeFor
 * bills each mode separately — so without this a customer joining a hatian and a
 * group buy in the same checkout pays twice for the one parcel those orders
 * ship in. The fee is kept on the dearest cycle line and cleared from the rest:
 * the parcel costs at least its priciest item to pack, which is the same
 * reasoning packingFeeFor applies within a mode.
 *
 * When the cycle is already paid for, every cycle line is cleared. Lines outside
 * the cycle are returned untouched — their fee is not the cycle's to waive.
 *
 * Returns a new array; nothing is mutated.
 */
export function chargeCycleFeeOnce<T extends Feeable>(items: readonly T[], alreadyPaid: boolean): T[] {
  const dearest = items
    .filter((i) => CYCLE_KINDS.includes(i.kind))
    .reduce<T | null>((best, i) => ((i.packingFeePhp ?? 0) > (best?.packingFeePhp ?? 0) ? i : best), null);

  return items.map((item) => {
    if (!CYCLE_KINDS.includes(item.kind)) return item;
    const keeps = !alreadyPaid && dearest != null && item.kind === dearest.kind;
    return { ...item, packingFeePhp: keeps ? packingFeeDueThisCycle(item.packingFeePhp ?? 0, false) : 0 };
  });
}
