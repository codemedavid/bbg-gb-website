// A customer's orders, grouped into the batches they were placed in, and
// whether each hatian they joined actually got in - pure, no I/O and no clock.
//
// The orders page was a flat list with a per-order balance. It could not say
// which batch an order belonged to, and nothing anywhere told a customer
// whether the counter they joined had reached its minimum. So somebody had to
// work that out off the admin board and message each customer separately,
// which is exactly what the client described having to do.
//
// Two questions, in the customer's own words: "ano ang pumasok sa kanila" and
// "magkano babayaran". This answers both, per batch.
import type { KahatiStatus } from './kahati';
import { orderBalance } from './settlement';
import { round2 } from './pricing';

/**
 * What happened to one commitment, in the terms the customer asks it in.
 *
 * Three, not more. A customer wants to know whether their vials are going
 * ahead, still need help, or are gone. The counter's seven-way status is the
 * shop's business, not theirs.
 */
export type CommitmentVerdict = 'in' | 'waiting' | 'cancelled';

/** One hatian line a customer holds, with the counter's state beside it. */
export type CommitmentLine = {
  kahatiName: string;
  vials: number;
  lineTotalPhp: number;
  counterStatus: KahatiStatus;
  claimedSlots: number;
  /** The minimum THIS counter was created under, frozen per counter. */
  minViableVials: number;
};

/** Counters that have finished deciding and are going ahead. */
const SEALED: readonly string[] = ['closed', 'shipped', 'completed'];

/**
 * Did this commitment get into a batch?
 *
 * A sealed counter is going ahead whatever its count reads - an admin closed
 * it, or it filled its kit - so it is 'in' without consulting the minimum.
 * Telling a customer their vials are "still filling" on a batch that is already
 * being ordered is the confusion this screen exists to end.
 *
 * A live counter, Kahati or its Pasalo rescue window, is judged on whether it
 * has reached its own frozen minimum. Read off the counter rather than the
 * global 7 so a batch created under a different rule is judged by the rule it
 * was created under, and a counter capped below the constant is not left
 * permanently short of a number it could never reach.
 */
export function commitmentVerdict(line: CommitmentLine): CommitmentVerdict {
  if (line.counterStatus === 'cancelled') return 'cancelled';
  if (SEALED.includes(line.counterStatus)) return 'in';
  return line.claimedSlots >= line.minViableVials ? 'in' : 'waiting';
}

export type StagedCommitmentLine = CommitmentLine & { verdict: CommitmentVerdict };

/** One of the customer's orders, as the batch view lists it. */
export type BatchOrder = {
  orderId: string;
  orderNo: string;
  status: string;
  buyType: string;
  /** orders.cycle_key - the batch. Null for orders placed before cycles existed. */
  cycleKey: string | null;
  totalPhp: number;
  downpaymentPhp: number;
  /** orders.payment_status - what checkout took, and whether an admin verified it. */
  paymentStatus?: string | null;
  /** The hatian settlement that collects the balance, if one was submitted. */
  settlementStatus?: string | null;
  placedAt: string;
  commitments: CommitmentLine[];
};

/**
 * What is still to collect on one order.
 *
 * Checkout takes different money on the two kinds of order, so "confirmed"
 * means different things. A group buy is paid in full at checkout: once an
 * admin confirms it, nothing is owed. A hatian order's checkout takes only the
 * packing fee, and its balance is collected by the settlement - so only a PAID
 * settlement clears it. Reading 'confirmed' as "paid in full" there would hide
 * every hatian balance the moment its ₱150 cleared.
 *
 * An unverified proof clears nothing on either: a screenshot is not a payment
 * until someone has checked it.
 */
function amountOwed(order: BatchOrder): number {
  if (order.status === 'cancelled') return 0;
  if (order.buyType === 'kahati') return order.settlementStatus === 'paid' ? 0 : orderBalance(order);
  if (order.paymentStatus === 'confirmed' || order.paymentStatus === 'not_due') return 0;
  return orderBalance(order);
}

export type BatchOrderView = Omit<BatchOrder, 'commitments'> & {
  commitments: StagedCommitmentLine[];
};

export type OrderBatch = {
  cycleKey: string | null;
  /** Earliest order in the batch, for dating it on screen. */
  placedAt: string;
  orders: BatchOrderView[];
  /** Vials on batches that are going ahead. */
  vialsIn: number;
  /** Vials on counters still short of their minimum. */
  vialsWaiting: number;
  /** Vials on counters that fell through and are being refunded. */
  vialsCancelled: number;
  /** What is still to collect across the batch - the "magkano babayaran". */
  amountDuePhp: number;
};

type VialBucket = 'vialsIn' | 'vialsWaiting' | 'vialsCancelled';

const BUCKET: Record<CommitmentVerdict, VialBucket> = {
  in: 'vialsIn', waiting: 'vialsWaiting', cancelled: 'vialsCancelled',
};

// Null cannot share a Map with real cycle keys, so unbatched orders collect
// under a sentinel that no cycle key can collide with and are appended last.
const UNBATCHED = ' unbatched';

/**
 * Groups a customer's orders into their batches, newest batch first.
 *
 * Orders placed before cycles were stamped belong to no batch. They are still
 * the customer's orders, so they are kept and grouped last under a null key
 * rather than dropped: a missing order reads as a lost one.
 *
 * A cancelled order owes nothing. Chasing a customer to pay for a batch that
 * was never ordered is precisely the message this view exists to stop.
 *
 * Returns new rows throughout; the caller's orders are not touched.
 */
export function groupOrdersIntoBatches(orders: readonly BatchOrder[]): OrderBatch[] {
  const byCycle = new Map<string, OrderBatch>();

  for (const order of orders) {
    const key = order.cycleKey ?? UNBATCHED;
    const batch = byCycle.get(key) ?? {
      cycleKey: order.cycleKey,
      placedAt: order.placedAt,
      orders: [],
      vialsIn: 0,
      vialsWaiting: 0,
      vialsCancelled: 0,
      amountDuePhp: 0,
    };

    const commitments = order.commitments.map((line) => ({ ...line, verdict: commitmentVerdict(line) }));
    for (const line of commitments) batch[BUCKET[line.verdict]] += line.vials;

    batch.amountDuePhp = round2(batch.amountDuePhp + amountOwed(order));
    if (order.placedAt < batch.placedAt) batch.placedAt = order.placedAt;
    batch.orders.push({ ...order, commitments });
    byCycle.set(key, batch);
  }

  const unbatched = byCycle.get(UNBATCHED);
  byCycle.delete(UNBATCHED);

  // Newest batch first: it is the one the customer is being asked to pay for.
  const batched = [...byCycle.values()]
    .sort((a, b) => (b.cycleKey ?? '').localeCompare(a.cycleKey ?? ''));

  return unbatched ? [...batched, unbatched] : batched;
}
