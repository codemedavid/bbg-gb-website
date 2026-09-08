// How much of a Kahati batch came from Pasalo — pure, no I/O and no clock.
//
// Kahati and Pasalo are ONE report. A Pasalo commitment is a commitment to a
// group_buys counter, so checkout stamps it buy_type 'kahati' and it lands in
// the Kahati half of the weekly report (lib/report/segment.ts). That is the
// rule the client set, and the reason for it: the vials Pasalo fills are the
// vials the Kahati batch needed, so they are one order to the supplier.
//
// Sharing a report is not the same as being indistinguishable, though. This
// splits the segment's vials into the two stages that produced them, so the one
// report can still say "9 Kahati + 2 Pasalo" — the same sentence
// lib/pasalo.ts:pasaloFailureReason writes onto a refund, computed the same way
// so a batch sheet and a refund cannot disagree about the same vials.
//
// Per counter, never globally: each counter has its own frozen boundary, and
// one pass over every line in the range would let a full counter's vials push
// the next counter's first joiner past a boundary that has nothing to do with
// it.
import { attributeParticipantStages, summariseParticipantStages } from '../hatian-participants';
import type { ReportOrderInput } from './build';

export type KahatiStageVials = {
  /** Vials on the counters when Kahati closed. */
  kahatiVials: number;
  /** Vials the second window brought in, completing those batches. */
  pasaloVials: number;
  /** The two above, which are a split of this and never change it. */
  totalVials: number;
  /** Counters the range touched, for the "across N counters" wording. */
  counters: number;
};

const EMPTY: KahatiStageVials = { kahatiVials: 0, pasaloVials: 0, totalVials: 0, counters: 0 };

/** One counter line, reduced to what the stage walk needs. */
type CounterLine = {
  orderId: string;
  orderStatus: string;
  vials: number;
  committedAt: string;
  /** The counter's frozen Kahati count; null while Kahati never closed. */
  frozen: number | null;
};

/**
 * Splits a segment's counter vials into the stage that sold them.
 *
 * Reads only lines that reference a counter — on-hand and MOQ-shelf lines
 * belong to other reports and are skipped rather than counted as vials some
 * stage filled. Cancelled orders count for neither stage, because nobody is
 * ordering those vials from the supplier; that is the same exclusion the money
 * totals and the packing list already make.
 */
export function splitKahatiStageVials(orders: readonly ReportOrderInput[]): KahatiStageVials {
  const byCounter = new Map<string, CounterLine[]>();

  for (const order of orders) {
    for (const item of order.items) {
      const counterId = item.groupBuyId;
      // No counter reference: an on-hand, MOQ-shelf or campaign line.
      if (!counterId) continue;
      const lines = byCounter.get(counterId) ?? [];
      lines.push({
        // The stage walk keys rows by orderId to keep a stable tie-break; the
        // order number is unique per order and is what this report has.
        orderId: order.orderNo,
        orderStatus: order.status,
        vials: item.qty,
        committedAt: order.createdAt,
        frozen: item.counterKahatiVials ?? null,
      });
      byCounter.set(counterId, lines);
    }
  }

  if (byCounter.size === 0) return EMPTY;

  let kahatiVials = 0;
  let pasaloVials = 0;
  for (const lines of byCounter.values()) {
    // The frozen count belongs to the counter, so every line of it carries the
    // same value; the first is as good as any. A counter whose rows disagree
    // could only have been hand-written, and taking one answer is better than
    // inventing a third.
    const staged = attributeParticipantStages(lines, { kahatiVials: lines[0].frozen });
    const split = summariseParticipantStages(staged);
    kahatiVials += split.kahatiVials;
    pasaloVials += split.pasaloVials;
  }

  return {
    kahatiVials,
    pasaloVials,
    // Derived from the halves rather than summed again off the lines, so the
    // two can never fail to add up to it.
    totalVials: kahatiVials + pasaloVials,
    counters: byCounter.size,
  };
}
