// The MOQ shelf's own rules: progress towards a target, and what a customer's
// line is doing while that target fills.
//
// Deliberately NOT lib/group-buy.ts. A group buy batch is one supplier
// consignment capped at MOQ_BATCH_MAX_KITS kits, so groupBuyMoqStatus clamps
// capacity to 10 and spills the rest into a successor batch. A shelf item has no
// such box: its target is an arbitrary number of units, over-filling is the
// stated goal ("reach it or more"), and nothing rolls over mid-order. Reusing
// the batch helper here would render a 500-unit target as 10/10.
import { describe, it, expect } from 'vitest';
import { moqProductStatus, moqLineOutcome, closedCycle } from './moq-product-cycle';

describe('moqProductStatus', () => {
  it('reports progress towards the target', () => {
    expect(moqProductStatus(120, 500)).toMatchObject({
      committed: 120, moq: 500, remaining: 380, reached: false,
    });
  });

  it('scales progress to the target rather than to a ten-kit batch', () => {
    // The bug this pins: batchCapacity() would cap a 500-unit target at 10.
    expect(moqProductStatus(250, 500).progress).toBe(0.5);
  });

  it('marks the target reached exactly on the nose', () => {
    expect(moqProductStatus(500, 500).reached).toBe(true);
    expect(moqProductStatus(499, 500).reached).toBe(false);
  });

  it('keeps counting past the target — overshooting is allowed', () => {
    const s = moqProductStatus(620, 500);
    expect(s.committed).toBe(620);
    expect(s.reached).toBe(true);
    expect(s.remaining).toBe(0);
  });

  it('clamps the progress bar at full even when overshooting', () => {
    expect(moqProductStatus(620, 500).progress).toBe(1);
  });

  it('starts an untouched shelf item at zero', () => {
    expect(moqProductStatus(0, 500)).toMatchObject({ progress: 0, remaining: 500, reached: false });
  });

  it('survives a target of zero without dividing by it', () => {
    const s = moqProductStatus(0, 0);
    expect(Number.isFinite(s.progress)).toBe(true);
    expect(s.moq).toBe(1);
  });

  it('never reports a negative commitment', () => {
    expect(moqProductStatus(-5, 500).committed).toBe(0);
  });
});

describe('moqLineOutcome', () => {
  const line = { lineCycleNo: 1, productCycleNo: 1, reached: false, orderStatus: 'proof_review' as const };

  it('waits while the current cycle is short of its target', () => {
    expect(moqLineOutcome(line)).toBe('awaiting_moq');
  });

  it('proceeds once the current cycle reaches its target', () => {
    expect(moqLineOutcome({ ...line, reached: true })).toBe('processing');
  });

  // The reason the cycle number is snapshotted on the line at all: once the
  // admin closes cycle 1 and the counter resets to 0 for cycle 2, a cycle-1
  // order must not flip back to "waiting" on a target it already met.
  it('keeps a line from a closed cycle proceeding after the counter resets', () => {
    expect(moqLineOutcome({ ...line, lineCycleNo: 1, productCycleNo: 2, reached: false })).toBe('processing');
  });

  it('reads a refund off the order, whatever the cycle is doing', () => {
    expect(moqLineOutcome({ ...line, orderStatus: 'cancelled', reached: true })).toBe('refunded');
  });

  // Legacy lines predate the snapshot and carry no cycle number. They belong to
  // whatever the shelf is doing now — the honest answer, and never 'refunded'.
  it('treats a line with no recorded cycle as part of the current one', () => {
    expect(moqLineOutcome({ ...line, lineCycleNo: null, reached: true })).toBe('processing');
    expect(moqLineOutcome({ ...line, lineCycleNo: null, reached: false })).toBe('awaiting_moq');
  });
});

describe('closedCycle', () => {
  it('opens the next round with the counter back at zero', () => {
    expect(closedCycle({ cycleNo: 1, committed: 500 })).toEqual({ cycleNo: 2, committed: 0 });
  });

  it('keeps numbering rounds upwards', () => {
    expect(closedCycle({ cycleNo: 7, committed: 12 })).toEqual({ cycleNo: 8, committed: 0 });
  });

  // Closing short is a real decision, not an error: the admin placed the order
  // with the supplier anyway. The lines in that round proceed.
  it('closes a cycle that never reached its target', () => {
    expect(closedCycle({ cycleNo: 1, committed: 3 })).toEqual({ cycleNo: 2, committed: 0 });
  });
});
