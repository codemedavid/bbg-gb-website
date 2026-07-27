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
import { round2, splitKahatiDownpayment } from './pricing';
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

// Whether the customer's place in the next parcel is already paid for. Any one
// open hatian is enough — the deposit is per customer, not per hatian, which is
// why a commitment on a different product still counts.
export function hasOpenKahatiCommitment(
  commitments: readonly Pick<KahatiCommitment, 'kahatiStatus'>[],
): boolean {
  return commitments.some((c) => c.kahatiStatus === 'open');
}

// The downpayment a kahati order actually owes at checkout. Zero once a
// commitment is live; otherwise the admin-set deposit, clamped to the order
// total so a small commitment never owes more than it costs.
export function kahatiDownpaymentDue(
  total: number,
  downpaymentPhp: number,
  alreadyCommitted: boolean,
): number {
  if (alreadyCommitted) return 0;
  return splitKahatiDownpayment(total, downpaymentPhp).downpayment;
}

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
