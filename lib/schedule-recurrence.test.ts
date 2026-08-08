// The weekly window Group Buy and Hatian both trade in.
//
// The rule the business states is "opens Wednesday, closes Wednesday", and the
// single most expensive way to get that wrong is to resolve it as a window that
// lasts a few hours instead of a week. So the same-weekday case is pinned first
// and hardest here, alongside the eight-hour timezone error every date rule in
// this codebase is one mistake away from.
import { describe, it, expect } from 'vitest';
import {
  cycleAt, nextCycle, isRecurrenceOpen, cycleKeyOf,
  type ScheduleRecurrence,
} from '@/lib/schedule-recurrence';

const WED = 3;
const SAT = 6;

// Opens Wednesday 8:00 PM PHT, closes the following Wednesday 6:00 PM PHT.
const WED_TO_WED: ScheduleRecurrence = {
  openDay: WED, openTime: '20:00', closeDay: WED, closeTime: '18:00',
};

// Aug 5, 12 and 19 of 2026 are all Wednesdays. Manila is UTC+08:00, so
// 20:00 PHT is 12:00 UTC the same day and 18:00 PHT is 10:00 UTC.
const OPENS = '2026-08-05T12:00:00.000Z'; // Wed Aug 5, 8:00 PM PHT
const CLOSES = '2026-08-12T10:00:00.000Z'; // Wed Aug 12, 6:00 PM PHT

describe('cycleAt — the same-weekday window is a full week', () => {
  it('resolves Wednesday to Wednesday as a seven-day cycle', () => {
    // Arrange
    const now = new Date('2026-08-08T00:00:00.000Z'); // Saturday, mid-cycle

    // Act
    const cycle = cycleAt(WED_TO_WED, now);

    // Assert
    expect(cycle).toEqual({ opensAt: OPENS, closesAt: CLOSES });
  });

  it('runs a full week even when the closing time is later in the day than the opening', () => {
    // 9:00 AM -> 6:00 PM on the same weekday is the shape most likely to be
    // resolved as a nine-hour window. It is a week: the boards trade Wednesday
    // to Wednesday, not for one morning.
    const sched: ScheduleRecurrence = {
      openDay: WED, openTime: '09:00', closeDay: WED, closeTime: '18:00',
    };

    const cycle = cycleAt(sched, new Date('2026-08-05T02:00:00.000Z')); // Wed 10:00 PHT

    expect(cycle).toEqual({
      opensAt: '2026-08-05T01:00:00.000Z', // Wed Aug 5, 9:00 AM PHT
      closesAt: '2026-08-12T10:00:00.000Z', // Wed Aug 12, 6:00 PM PHT
    });
  });

  it('rolls to the current week, not the first week ever', () => {
    // Two months later still resolves to the cycle containing `now`.
    const cycle = cycleAt(WED_TO_WED, new Date('2026-10-08T00:00:00.000Z'));

    expect(cycle).toEqual({
      opensAt: '2026-10-07T12:00:00.000Z', // Wed Oct 7, 8:00 PM PHT
      closesAt: '2026-10-14T10:00:00.000Z', // Wed Oct 14, 6:00 PM PHT
    });
  });
});

describe('cycleAt — boundaries', () => {
  it('is open at the opening instant', () => {
    // Inclusive: a window set to open at 8:00 PM is open at 8:00:00 PM.
    expect(cycleAt(WED_TO_WED, new Date(OPENS))).toEqual({ opensAt: OPENS, closesAt: CLOSES });
  });

  it('is closed at the closing instant', () => {
    // Exclusive at the top, so one cycle and its successor never overlap.
    expect(cycleAt(WED_TO_WED, new Date(CLOSES))).toBeNull();
  });

  it('is closed in the gap between the close and the next opening', () => {
    // Wednesday 6:00 PM to 8:00 PM: the boards are dark for two hours a week.
    expect(cycleAt(WED_TO_WED, new Date('2026-08-12T11:00:00.000Z'))).toBeNull();
  });

  it('reopens at the next opening after the gap', () => {
    const cycle = cycleAt(WED_TO_WED, new Date('2026-08-12T12:00:00.000Z'));

    expect(cycle).toEqual({
      opensAt: '2026-08-12T12:00:00.000Z',
      closesAt: '2026-08-19T10:00:00.000Z',
    });
  });
});

describe('cycleAt — Philippine time, not the host clock', () => {
  it('is still closed one minute before the Manila opening', () => {
    // 11:59 UTC is 7:59 PM in Manila. A server reading its own clock, or adding
    // eight hours by hand, is what opens the boards eight hours early or late.
    expect(cycleAt(WED_TO_WED, new Date('2026-08-05T11:59:00.000Z'))).toBeNull();
  });

  it('opens on the Manila calendar day, not the UTC one', () => {
    // Wed 8:00 PM PHT is still Wednesday in Manila while being Wednesday noon
    // UTC; the window must key off the Manila weekday.
    const cycle = cycleAt(WED_TO_WED, new Date('2026-08-05T12:00:01.000Z'));
    expect(cycle?.opensAt).toBe(OPENS);
  });
});

describe('cycleAt — a window that spans different weekdays', () => {
  it('closes on the configured later weekday in the same week', () => {
    // The previous Wednesday -> Saturday arrangement, still supported.
    const sched: ScheduleRecurrence = {
      openDay: WED, openTime: '20:00', closeDay: SAT, closeTime: '23:59',
    };

    const cycle = cycleAt(sched, new Date('2026-08-07T00:00:00.000Z')); // Friday

    expect(cycle).toEqual({
      opensAt: '2026-08-05T12:00:00.000Z', // Wed Aug 5, 8:00 PM PHT
      closesAt: '2026-08-08T15:59:00.000Z', // Sat Aug 8, 11:59 PM PHT
    });
  });

  it('closes on the next occurrence when the closing weekday precedes the opening one', () => {
    // Saturday -> Wednesday wraps into the following week.
    const sched: ScheduleRecurrence = {
      openDay: SAT, openTime: '10:00', closeDay: WED, closeTime: '10:00',
    };

    const cycle = cycleAt(sched, new Date('2026-08-09T00:00:00.000Z')); // Sunday

    expect(cycle).toEqual({
      opensAt: '2026-08-08T02:00:00.000Z', // Sat Aug 8, 10:00 AM PHT
      closesAt: '2026-08-12T02:00:00.000Z', // Wed Aug 12, 10:00 AM PHT
    });
  });
});

describe('cycleAt — failing closed', () => {
  const now = new Date('2026-08-08T00:00:00.000Z');

  // Every one of these is a half-configured or corrupt schedule. All of them
  // read as CLOSED: a deploy that loses the recurrence must not throw both
  // boards open, and an admin's typo is not a window.
  const broken: [string, ScheduleRecurrence][] = [
    ['never configured', { openDay: null, openTime: null, closeDay: null, closeTime: null }],
    ['only the opening day', { openDay: WED, openTime: null, closeDay: null, closeTime: null }],
    ['missing the closing time', { openDay: WED, openTime: '20:00', closeDay: WED, closeTime: null }],
    ['a day out of range', { openDay: 7, openTime: '20:00', closeDay: WED, closeTime: '18:00' }],
    ['a negative day', { openDay: -1, openTime: '20:00', closeDay: WED, closeTime: '18:00' }],
    ['a fractional day', { openDay: 3.5, openTime: '20:00', closeDay: WED, closeTime: '18:00' }],
    ['an unpadded time', { openDay: WED, openTime: '9:00', closeDay: WED, closeTime: '18:00' }],
    ['an impossible hour', { openDay: WED, openTime: '24:00', closeDay: WED, closeTime: '18:00' }],
    ['an impossible minute', { openDay: WED, openTime: '20:60', closeDay: WED, closeTime: '18:00' }],
    ['an empty time', { openDay: WED, openTime: '', closeDay: WED, closeTime: '18:00' }],
    ['a time that is not a time', { openDay: WED, openTime: 'evening', closeDay: WED, closeTime: '18:00' }],
  ];

  for (const [label, sched] of broken) {
    it(`is closed with ${label}`, () => {
      expect(cycleAt(sched, now)).toBeNull();
      expect(isRecurrenceOpen(sched, now)).toBe(false);
    });
  }
});

describe('isRecurrenceOpen', () => {
  it('agrees with cycleAt inside the window', () => {
    expect(isRecurrenceOpen(WED_TO_WED, new Date('2026-08-08T00:00:00.000Z'))).toBe(true);
  });

  it('agrees with cycleAt outside the window', () => {
    expect(isRecurrenceOpen(WED_TO_WED, new Date('2026-08-12T11:00:00.000Z'))).toBe(false);
  });
});

describe('nextCycle', () => {
  it('is the upcoming window while the boards are dark', () => {
    // In the two-hour gap, the next cycle is the one about to open.
    const cycle = nextCycle(WED_TO_WED, new Date('2026-08-12T11:00:00.000Z'));

    expect(cycle).toEqual({
      opensAt: '2026-08-12T12:00:00.000Z',
      closesAt: '2026-08-19T10:00:00.000Z',
    });
  });

  it('is next week while the boards are open', () => {
    // Asked mid-cycle, "next" means the one after this — not the current one,
    // which would render an admin's countdown as "opens in 0m" while open.
    const cycle = nextCycle(WED_TO_WED, new Date('2026-08-08T00:00:00.000Z'));

    expect(cycle).toEqual({
      opensAt: '2026-08-12T12:00:00.000Z',
      closesAt: '2026-08-19T10:00:00.000Z',
    });
  });

  it('is null when nothing is configured', () => {
    expect(nextCycle({ openDay: null, openTime: null, closeDay: null, closeTime: null }, new Date()))
      .toBeNull();
  });
});

describe('cycleKeyOf', () => {
  it('is the same key everywhere inside one cycle', () => {
    // The key identifies the cycle a packing fee was paid in, so two orders
    // placed days apart in one window must produce one key.
    const monday = cycleAt(WED_TO_WED, new Date('2026-08-10T00:00:00.000Z'));
    const saturday = cycleAt(WED_TO_WED, new Date('2026-08-08T00:00:00.000Z'));

    expect(cycleKeyOf(monday!)).toBe(cycleKeyOf(saturday!));
  });

  it('differs between one cycle and the next', () => {
    const first = cycleAt(WED_TO_WED, new Date('2026-08-08T00:00:00.000Z'));
    const second = cycleAt(WED_TO_WED, new Date('2026-08-15T00:00:00.000Z'));

    expect(cycleKeyOf(first!)).not.toBe(cycleKeyOf(second!));
  });
});
