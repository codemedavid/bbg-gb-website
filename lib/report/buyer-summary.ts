// Per-buyer rollup for the report's SUMMARY sheet.
//
// The order sheet answers "what is in order GB-2559" and the product rollup
// answers "how many TR30 do we owe the supplier". Neither answers the question
// the team actually gets asked on packing day — "what is Reylyn's whole batch,
// and what does she owe" — because a customer who checked out four times is
// four rows on the order sheet and nowhere at all on the product sheet. This is
// that pivot: one block per buyer, their products under it, their money at the
// top of it.
//
// The packing fee is a line of its own rather than a hidden addend. A buyer's
// amount has to reconcile against what was actually collected from them, and a
// figure that quietly folds the fee in cannot be checked against the goods.
//
// Pure: no I/O, no clock. Types come from build.ts as type-only imports so the
// value dependency runs one way (build.ts -> here) and there is no import cycle.
import { num, round2 } from './money';
import type { ReportOrderInput } from './build';

/** One product under a buyer, or that buyer's packing fee. */
export type BuyerSummaryLine = {
  /** Price-list code where the line has one, else the name snapshot. */
  label: string;
  /** Units. Zero on the packing fee line — a fee is not a vial. */
  qty: number;
  amountPhp: number;
};

export type BuyerSummaryGroup = {
  buyer: string;
  qty: number;
  amountPhp: number;
  lines: BuyerSummaryLine[];
};

export type BuyerSummary = {
  groups: BuyerSummaryGroup[];
  totals: { qty: number; amountPhp: number };
};

export const PACKING_FEE_LABEL = 'Packing fee';

type Accumulator = {
  buyer: string;
  packingFeePhp: number;
  /** Keyed by label so a product repeated across orders lands on one line. */
  lines: Map<string, BuyerSummaryLine>;
};

export function buildBuyerSummary(orders: readonly ReportOrderInput[]): BuyerSummary {
  const byBuyer = new Map<string, Accumulator>();

  for (const order of orders) {
    // Cancelled orders are excluded for the same reason the money totals
    // exclude them: nobody is shipping those vials or keeping that fee.
    if (order.status === 'cancelled') continue;

    const buyer = order.shipName;
    const acc = byBuyer.get(buyer) ?? { buyer, packingFeePhp: 0, lines: new Map() };
    acc.packingFeePhp += num(order.packingFeePhp);

    for (const item of order.items) {
      // The sheet is read against the price list, so the code leads where there
      // is one. Kahati and MOQ lines reference no product row and have only
      // their snapshot to be known by.
      const label = item.code || item.nameSnapshot;
      const seen = acc.lines.get(label);
      const amountPhp = num(item.unitPricePhp) * item.qty;
      acc.lines.set(label, seen
        ? { ...seen, qty: seen.qty + item.qty, amountPhp: seen.amountPhp + amountPhp }
        : { label, qty: item.qty, amountPhp });
    }

    byBuyer.set(buyer, acc);
  }

  const groups = [...byBuyer.values()]
    .map((acc) => {
      const lines = [...acc.lines.values()]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((line) => ({ ...line, amountPhp: round2(line.amountPhp) }));

      // Last, and only when there is one to show: a ₱0 fee row reads as a
      // waiver that was applied, which is a different claim from "not charged".
      if (acc.packingFeePhp > 0) {
        lines.push({ label: PACKING_FEE_LABEL, qty: 0, amountPhp: round2(acc.packingFeePhp) });
      }

      return {
        buyer: acc.buyer,
        qty: lines.reduce((sum, l) => sum + l.qty, 0),
        amountPhp: round2(lines.reduce((sum, l) => sum + l.amountPhp, 0)),
        lines,
      };
    })
    // Alphabetical, matching the pivot the team already circulates. Insertion
    // order would follow whatever the query happened to return and reshuffle
    // between runs of the same range.
    .sort((a, b) => a.buyer.localeCompare(b.buyer));

  return {
    groups,
    totals: {
      qty: groups.reduce((sum, g) => sum + g.qty, 0),
      amountPhp: round2(groups.reduce((sum, g) => sum + g.amountPhp, 0)),
    },
  };
}
