// Which cycle the boards are in, when a cycle can come from EITHER the weekly
// schedule or an admin starting one by hand.
//
// The schedule alone answered this until 2026-09-10, when "Start new cycle"
// was pressed against a paused schedule and did nothing customers could see:
// the listings rolled, the gate stayed shut. A cycle an admin starts has to be
// a cycle in its own right — an opening instant that names it, a close, and
// precedence over whatever the schedule was saying — or the button is not a
// control, it is a suggestion.
//
// Everything here is a pure function of (state, now), for the same reason
// lib/schedule-recurrence.ts is: the gate, the admin card and the checkout all
// ask, and each would otherwise keep its own opinion of who wins.
import { describe, it, expect } from 'vitest';
import {
  currentCycleOf, latestCycleOf, manualCycleFrom, MANUAL_CYCLE_DEFAULT_MS,
} from '@/lib/cycle-resolver';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const UNSET = { openDay: null, openTime: null, closeDay: null, closeTime: null };
// Opens Saturday 04:00 PHT, closes Sunday 23:00 PHT — production's schedule.
const SAT_TO_SUN = { openDay: 6, openTime: '04:00', closeDay: 0, closeTime: '23:00' };

// Sat 12 Sep 2026 04:00 PHT is 2026-09-11T20:00Z; Sun 13 Sep 23:00 PHT is 2026-09-13T15:00Z.
const SCHEDULED = { opensAt: '2026-09-11T20:00:00.000Z', closesAt: '2026-09-13T15:00:00.000Z' };
const THURSDAY = new Date('2026-09-10T02:00:00.000Z'); // Thu 10:00 PHT, boards dark
const SATURDAY_NOON = new Date('2026-09-12T04:00:00.000Z'); // Sat 12:00 PHT, boards open

describe('manualCycleFrom', () => {
  it('runs from now until the next scheduled opening when the boards are dark', () => {
    // The schedule resumes on its own terms: an override fills the gap, it does
    // not push the next scheduled cycle back.
    const cycle = manualCycleFrom(SAT_TO_SUN, THURSDAY);

    expect(cycle).toEqual({ opensAt: THURSDAY.toISOString(), closesAt: SCHEDULED.opensAt });
  });

  it('keeps the running cycle\'s close when started mid-cycle', () => {
    // Pressed on Saturday noon: the new cycle ends when Saturday's would have,
    // not a week later. Ending a cycle early must not lengthen the window.
    const cycle = manualCycleFrom(SAT_TO_SUN, SATURDAY_NOON);

    expect(cycle).toEqual({ opensAt: SATURDAY_NOON.toISOString(), closesAt: SCHEDULED.closesAt });
  });

  it('runs for the default span when no schedule is set', () => {
    const cycle = manualCycleFrom(UNSET, THURSDAY);

    expect(cycle).toEqual({
      opensAt: THURSDAY.toISOString(),
      closesAt: new Date(THURSDAY.getTime() + MANUAL_CYCLE_DEFAULT_MS).toISOString(),
    });
  });
});

describe('latestCycleOf / currentCycleOf', () => {
  const manual = { opensAt: THURSDAY.toISOString(), closesAt: SCHEDULED.opensAt };

  it('is the schedule\'s cycle when nothing was started by hand', () => {
    const state = { recurrence: SAT_TO_SUN, manual: null, pausedUntil: null };

    expect(currentCycleOf(state, SATURDAY_NOON)).toEqual({ ...SCHEDULED, source: 'schedule' });
    expect(currentCycleOf(state, THURSDAY)).toBeNull();
  });

  it('is the manual cycle while it runs, even though the schedule says dark', () => {
    const state = { recurrence: SAT_TO_SUN, manual, pausedUntil: null };
    const friday = new Date(THURSDAY.getTime() + DAY);

    expect(currentCycleOf(state, friday)).toEqual({ ...manual, source: 'manual' });
    expect(latestCycleOf(state, friday)).toEqual({ ...manual, source: 'manual' });
  });

  it('hands back to the schedule once its next cycle opens', () => {
    // Saturday 04:00 the schedule opens a cycle that started LATER than the
    // manual one did, so it is the newer cycle and it wins.
    const state = { recurrence: SAT_TO_SUN, manual, pausedUntil: null };

    expect(currentCycleOf(state, SATURDAY_NOON)).toEqual({ ...SCHEDULED, source: 'schedule' });
    expect(latestCycleOf(state, SATURDAY_NOON)).toEqual({ ...SCHEDULED, source: 'schedule' });
  });

  it('outranks a running scheduled cycle when started inside one', () => {
    // Started Saturday noon, mid-cycle: the manual cycle opened later, so from
    // that instant it is the cycle — with its own key — and the scheduled one
    // that was running is the cycle that just ended.
    const midCycle = { opensAt: SATURDAY_NOON.toISOString(), closesAt: SCHEDULED.closesAt };
    const state = { recurrence: SAT_TO_SUN, manual: midCycle, pausedUntil: null };
    const later = new Date(SATURDAY_NOON.getTime() + HOUR);

    expect(currentCycleOf(state, later)).toEqual({ ...midCycle, source: 'manual' });
  });

  it('is closed once the manual cycle has elapsed, but still the latest', () => {
    // Between a manual close and the next scheduled open, the boards are dark
    // and the admin is still working the manual cycle's orders.
    const short = { opensAt: THURSDAY.toISOString(), closesAt: new Date(THURSDAY.getTime() + HOUR).toISOString() };
    const state = { recurrence: SAT_TO_SUN, manual: short, pausedUntil: null };
    const afterwards = new Date(THURSDAY.getTime() + 2 * HOUR);

    expect(currentCycleOf(state, afterwards)).toBeNull();
    expect(latestCycleOf(state, afterwards)).toEqual({ ...short, source: 'manual' });
  });

  it('is closed by a pause, whichever source the cycle came from', () => {
    const friday = new Date(THURSDAY.getTime() + DAY);
    const pausedUntil = new Date(friday.getTime() + HOUR).toISOString();
    const state = { recurrence: SAT_TO_SUN, manual, pausedUntil };

    expect(currentCycleOf(state, friday)).toBeNull();
    // A pause closes the boards; it does not un-name the cycle being worked.
    expect(latestCycleOf(state, friday)).toEqual({ ...manual, source: 'manual' });
  });

  it('ignores a manual cycle that has not opened yet', () => {
    // Never written by the app — a manual cycle opens at the instant it is
    // started — but a clock skew or a hand-edited row must not open the boards
    // early.
    const future = { opensAt: SCHEDULED.closesAt, closesAt: new Date(Date.parse(SCHEDULED.closesAt) + DAY).toISOString() };
    const state = { recurrence: SAT_TO_SUN, manual: future, pausedUntil: null };

    expect(currentCycleOf(state, SATURDAY_NOON)).toEqual({ ...SCHEDULED, source: 'schedule' });
  });

  it('is the manual cycle alone when no schedule is set', () => {
    const state = { recurrence: UNSET, manual, pausedUntil: null };

    expect(currentCycleOf(state, THURSDAY)).toEqual({ ...manual, source: 'manual' });
    expect(currentCycleOf({ ...state, manual: null }, THURSDAY)).toBeNull();
  });
});
