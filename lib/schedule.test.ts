// The scheduled-open rules, as pure functions.
//
// Both boards share them: a Kahati counter and a Group Buy batch answer the same
// two questions — "does this row start open, or does it wait?" and "is the
// window the admin typed a coherent one?" — so the answers live in one module
// rather than being re-derived on each board.
import { describe, it, expect } from 'vitest';
import { openingStatus, scheduleWindowError } from './schedule';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-08-03T12:00:00.000Z');

describe('openingStatus', () => {
  it('opens immediately when no open date was set', () => {
    expect(openingStatus(null, NOW)).toBe('open');
  });

  it('waits when the open date is still in the future', () => {
    expect(openingStatus(at('2026-08-04T12:00:00.000Z'), NOW)).toBe('scheduled');
  });

  it('opens when the open date has already passed', () => {
    expect(openingStatus(at('2026-08-02T12:00:00.000Z'), NOW)).toBe('open');
  });

  // The boundary is inclusive: at the stroke of the open time the row is open,
  // not still waiting. A row that had to wait for the *next* sweep to pass a
  // strictly-greater check would read as closed for its own opening minute.
  it('opens at exactly the open date', () => {
    expect(openingStatus(NOW, NOW)).toBe('open');
  });
});

describe('scheduleWindowError', () => {
  it('accepts an open date before the close date', () => {
    expect(scheduleWindowError(at('2026-08-04T00:00:00.000Z'), at('2026-08-10T00:00:00.000Z'))).toBeNull();
  });

  it('rejects an open date after the close date', () => {
    expect(scheduleWindowError(at('2026-08-11T00:00:00.000Z'), at('2026-08-10T00:00:00.000Z')))
      .toMatch(/before/i);
  });

  // Opening and closing at the same instant is a zero-length window: the row
  // would go on the board and come straight back off, having accepted nothing.
  it('rejects an open date equal to the close date', () => {
    const t = at('2026-08-10T00:00:00.000Z');
    expect(scheduleWindowError(t, t)).toMatch(/before/i);
  });

  it('accepts either half being absent', () => {
    expect(scheduleWindowError(null, at('2026-08-10T00:00:00.000Z'))).toBeNull();
    expect(scheduleWindowError(at('2026-08-10T00:00:00.000Z'), null)).toBeNull();
    expect(scheduleWindowError(null, null)).toBeNull();
  });
});
