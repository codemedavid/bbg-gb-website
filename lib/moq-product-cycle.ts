// The MOQ shelf: progress towards a target, and cycles.
//
// A shelf item is an aggregate buy. Its MOQ is the number of units all buyers
// TOGETHER must reach before the order goes to the supplier — not a per-customer
// floor, and not a stock ceiling. `committed` climbs; nothing is drawn down.
//
// Kept apart from lib/group-buy.ts on purpose. That module governs group buy
// BATCHES: one supplier consignment, capped at MOQ_BATCH_MAX_KITS kits, with the
// overflow rolling into a successor batch mid-order. None of that is true here —
// a shelf target is an arbitrary unit count, overshooting it is the stated goal,
// and a round only ends when an admin says so. Sharing groupBuyMoqStatus would
// clamp a 500-unit target to a ten-kit batch and render it 10/10.
import type { OrderStatus } from './db/schema';

export type MoqProductStatus = {
  // Not clamped to the target: 620/500 is a real and good state on this shelf,
  // unlike a batch, which physically cannot hold more than it holds.
  committed: number;
  moq: number;
  remaining: number;
  progress: number; // 0..1, clamped so the bar cannot overflow its track
  reached: boolean;
};

// A target of zero would divide the progress bar by nothing, so it floors at 1 —
// the smallest buy that can meaningfully be "reached".
const targetOf = (moq: number): number =>
  Number.isFinite(moq) ? Math.max(1, Math.floor(moq)) : 1;

export function moqProductStatus(committed: number, moq: number): MoqProductStatus {
  const target = targetOf(moq);
  const held = Math.max(0, Math.floor(committed));
  return {
    committed: held,
    moq: target,
    remaining: Math.max(0, target - held),
    progress: Math.min(1, held / target),
    reached: held >= target,
  };
}

export type MoqLineOutcome = 'awaiting_moq' | 'processing' | 'refunded';

// What one customer's MOQ line is doing.
//
// The cycle numbers are the whole reason this is not just `reached`. A line
// records the cycle it joined; once that cycle closes, the shelf's counter goes
// back to zero for the next round. Comparing against the live counter alone
// would tell every customer from round 1 that they are waiting again.
export function moqLineOutcome(args: {
  lineCycleNo: number | null;
  productCycleNo: number;
  reached: boolean;
  orderStatus: OrderStatus;
}): MoqLineOutcome {
  if (args.orderStatus === 'cancelled') return 'refunded';
  // A line from a round that has already been closed and ordered.
  if (args.lineCycleNo != null && args.lineCycleNo < args.productCycleNo) return 'processing';
  return args.reached ? 'processing' : 'awaiting_moq';
}

// Close the current round and open the next. Closing SHORT of the target is
// allowed and meaningful: it is the admin recording that the buy was placed
// anyway, which is exactly what moves that round's lines to 'processing'.
export function closedCycle(p: { cycleNo: number; committed: number }): { cycleNo: number; committed: number } {
  return { cycleNo: p.cycleNo + 1, committed: 0 };
}
