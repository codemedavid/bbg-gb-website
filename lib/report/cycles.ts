// Batches, read off the orders rather than off the calendar.
//
// A batch is orders.cycle_key: the instant a cycle opened, stamped on every
// order placed under it. Cycles open at 22:00 Manila, so no From/To a person
// types reproduces one exactly — and the supplier sheet is sized by whatever
// range was typed. Summarising the cycles gives the Reports page a preset that
// comes from the orders themselves.
//
// Pure: no I/O, no clock.
import { formatDateRange, manilaYmd } from './week';

export type CycleOrderRow = {
  /** null for orders placed before cycles were stamped; those belong to no batch. */
  cycleKey: string | null;
  createdAt: string | Date;
  status: string;
  /** Group-buy vials on the order. */
  vials: number;
};

export type ReportCycle = {
  cycleKey: string;
  /** Manila date of the batch's first order — where the report range opens. */
  from: string;
  /** Manila date of its last order. */
  to: string;
  /** Every order in the batch, cancelled included, so it compares with the report header. */
  orderCount: number;
  /** Vials still being ordered: cancelled orders are out. */
  vials: number;
};

const ymd = (createdAt: string | Date): string =>
  manilaYmd(createdAt instanceof Date ? createdAt : new Date(createdAt));

/**
 * One row per batch, newest first.
 *
 * Dated from the orders in Manila, not from the cycle key: the key is a UTC
 * instant at 22:00 the evening BEFORE the batch's first working day, and a
 * range opened on that date would reach back into the batch before it.
 */
export function summarizeReportCycles(rows: readonly CycleOrderRow[]): ReportCycle[] {
  const byCycle = new Map<string, ReportCycle>();

  for (const row of rows) {
    if (!row.cycleKey) continue;
    const day = ymd(row.createdAt);
    const live = row.status === 'cancelled' ? 0 : row.vials;
    const seen = byCycle.get(row.cycleKey);

    byCycle.set(row.cycleKey, seen
      ? {
          ...seen,
          from: day < seen.from ? day : seen.from,
          to: day > seen.to ? day : seen.to,
          orderCount: seen.orderCount + 1,
          vials: seen.vials + live,
        }
      : { cycleKey: row.cycleKey, from: day, to: day, orderCount: 1, vials: live });
  }

  // Cycle keys are ISO instants, so lexical order is chronological order.
  return [...byCycle.values()].sort((a, b) => b.cycleKey.localeCompare(a.cycleKey));
}

// Which batch this is, said in the words the team uses. The dates and the order
// count ride along because "This batch" alone is ambiguous the moment a new
// cycle opens while the previous one is still being ordered from the supplier —
// which is exactly when the sheet gets downloaded.
const POSITION = ['This batch', 'Previous batch'] as const;

export function reportCycleLabel(cycle: ReportCycle, index: number): string {
  const position = POSITION[index] ?? 'Earlier batch';
  const orders = `${cycle.orderCount} order${cycle.orderCount === 1 ? '' : 's'}`;
  return `${position} · ${formatDateRange(cycle.from, cycle.to)} · ${orders}`;
}
