// Batches, as the orders themselves record them.
//
// A batch is a cycle — orders.cycle_key — and it does NOT line up with a
// calendar week: the Aug 29 cycle opened at 22:00 Manila and ran to 22:00 on
// Sep 5. Picking dates by hand is how one order from the next batch (KH-2829,
// 8 vials) ended up inside a supplier sheet for the previous one.
import { describe, it, expect } from 'vitest';
import { reportCycleLabel, summarizeReportCycles, type CycleOrderRow } from './cycles';

const row = (r: Partial<CycleOrderRow>): CycleOrderRow => ({
  cycleKey: '2026-08-29T14:00:00.000Z',
  createdAt: '2026-08-30T02:00:00Z',
  status: 'payment_confirmed',
  vials: 2,
  ...r,
});

describe('summarizeReportCycles', () => {
  it('groups orders into batches, newest batch first', () => {
    const cycles = summarizeReportCycles([
      row({ cycleKey: '2026-08-29T14:00:00.000Z' }),
      row({ cycleKey: '2026-09-05T14:00:00.000Z', createdAt: '2026-09-05T16:51:00Z' }),
      row({ cycleKey: '2026-08-29T14:00:00.000Z' }),
    ]);

    expect(cycles.map((c) => c.cycleKey)).toEqual([
      '2026-09-05T14:00:00.000Z',
      '2026-08-29T14:00:00.000Z',
    ]);
    expect(cycles[1].orderCount).toBe(2);
  });

  it('dates a batch by its own orders, in Manila', () => {
    // 16:30Z on Aug 29 is already Aug 30 in Manila. Dating the batch off the
    // UTC instant would open the range a day early and sweep in the batch
    // before it.
    const [cycle] = summarizeReportCycles([
      row({ createdAt: '2026-08-29T16:30:00Z' }),
      row({ createdAt: '2026-09-04T14:33:00Z' }),
    ]);

    expect(cycle.from).toBe('2026-08-30');
    expect(cycle.to).toBe('2026-09-04');
  });

  it('counts every order but totals only the vials still being ordered', () => {
    const [cycle] = summarizeReportCycles([
      row({ vials: 5 }),
      row({ vials: 3, status: 'cancelled' }),
    ]);

    // The count matches what the report's own header shows, cancelled included,
    // so a mismatch between the two is visible rather than silent.
    expect(cycle.orderCount).toBe(2);
    expect(cycle.vials).toBe(5);
  });

  it('ignores orders placed before batches were stamped', () => {
    expect(summarizeReportCycles([row({ cycleKey: null })])).toEqual([]);
    expect(summarizeReportCycles([])).toEqual([]);
  });
});

describe('reportCycleLabel', () => {
  const cycle = {
    cycleKey: '2026-08-29T14:00:00.000Z', from: '2026-08-30', to: '2026-09-04',
    orderCount: 87, vials: 542,
  };

  it('names the newest batch as the current one and carries its dates and size', () => {
    expect(reportCycleLabel(cycle, 0)).toBe('This batch · Aug 30, 2026 – Sep 4, 2026 · 87 orders');
  });

  it('names the one before it, so the batch being ordered is unambiguous', () => {
    expect(reportCycleLabel(cycle, 1)).toBe('Previous batch · Aug 30, 2026 – Sep 4, 2026 · 87 orders');
    expect(reportCycleLabel(cycle, 2)).toBe('Earlier batch · Aug 30, 2026 – Sep 4, 2026 · 87 orders');
  });

  it('says "1 order" rather than "1 orders"', () => {
    expect(reportCycleLabel({ ...cycle, orderCount: 1 }, 0)).toContain('· 1 order');
  });
});
