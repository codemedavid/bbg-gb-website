// Kahati commitments a customer already holds — the rules, with no database in
// sight.
//
// The downpayment is NOT a per-hatian charge. It reserves the customer's place
// in the next parcel, and it is asked for once while that place is held: a
// customer with a live order on a hatian that is STILL OPEN has already paid
// it, so joining another hatian (or more vials of the same one) is confirm-only
// — no downpayment, and with nothing due, no payment at all.
//
// The waiver lapses when every hatian they joined has sealed. At that point the
// parcel is being assembled and settled (lib/settlement.ts), and the next
// commitment starts a fresh cycle that pays its own downpayment.
import { round2 } from './pricing';
import type { KahatiStatus } from './kahati';

// One kahati line a customer holds, flattened from order -> order_item -> hatian.
// An order that overflowed into a rollover sibling contributes one entry per
// counter it claimed from, so `orderId` repeats and is what de-duplicates them.
export type KahatiCommitment = {
  orderId: string;
  orderNo: string;
  kahatiId: string;
  kahatiName: string;
  kahatiStatus: KahatiStatus;
  qty: number;
  lineTotalPhp: number;
  placedAt: string;
};

// One hatian's worth of what a customer holds. Keyed by NAME rather than id:
// a counter that fills seals and opens a fresh sibling carrying the same name,
// and to the customer that is one hatian they joined twice, not two hatians.
export type KahatiCommitmentGroup = {
  kahatiName: string;
  vials: number;
  totalPhp: number;
  orderNos: string[];
};

export type KahatiCommitmentSummary = {
  groups: KahatiCommitmentGroup[];
  vials: number;
  totalPhp: number;
  orderCount: number;
};

// Everything the customer has on order across their hatians, as the checkout
// screen shows it back to them. Groups keep first-seen order; order numbers are
// listed once each even when one order spans two counters.
export function summarizeKahatiCommitments(
  commitments: readonly KahatiCommitment[],
): KahatiCommitmentSummary {
  const byName = new Map<string, KahatiCommitmentGroup>();
  for (const c of commitments) {
    const group = byName.get(c.kahatiName) ?? { kahatiName: c.kahatiName, vials: 0, totalPhp: 0, orderNos: [] };
    byName.set(c.kahatiName, {
      ...group,
      vials: group.vials + c.qty,
      totalPhp: round2(group.totalPhp + c.lineTotalPhp),
      orderNos: group.orderNos.includes(c.orderNo) ? group.orderNos : [...group.orderNos, c.orderNo],
    });
  }
  const groups = [...byName.values()];
  return {
    groups,
    vials: groups.reduce((sum, g) => sum + g.vials, 0),
    totalPhp: round2(groups.reduce((sum, g) => sum + g.totalPhp, 0)),
    orderCount: new Set(commitments.map((c) => c.orderId)).size,
  };
}
