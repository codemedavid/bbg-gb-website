// The one schedule that opens and closes Group Buy and Hatian together.
//
// Everything here is deliberately pure: the rule "are we open right now" is
// asked from a route handler, a server component and the nav bar, and each of
// those would otherwise grow its own slightly different comparison. It is also
// the rule most likely to be wrong by eight hours, so the timezone conversion is
// pinned by tests rather than by reading it back off a running page.
import { describe, it, expect } from 'vitest';
import {
  isScheduleOpen, phtLocalToIso, isoToPhtLocal, formatPht,
  type GroupBuySchedule,
} from '@/lib/schedule';

// 09:00 in Manila is 01:00 UTC the same day; 23:59 Manila is 15:59 UTC.
const OPENS = '2026-08-04T01:00:00.000Z'; // Aug 4, 09:00 PHT
const CLOSES = '2026-08-11T15:59:00.000Z'; // Aug 11, 23:59 PHT
const WINDOW: GroupBuySchedule = { opensAt: OPENS, closesAt: CLOSES };

describe('isScheduleOpen', () => {
  it('is open inside the configured window', () => {
    // Arrange
    const now = new Date('2026-08-06T04:00:00.000Z');

    // Act
    const open = isScheduleOpen(WINDOW, now);

    // Assert
    expect(open).toBe(true);
  });

  it('is closed before the window opens', () => {
    expect(isScheduleOpen(WINDOW, new Date('2026-08-04T00:59:59.000Z'))).toBe(false);
  });

  it('is closed after the window has passed', () => {
    expect(isScheduleOpen(WINDOW, new Date('2026-08-11T16:00:00.000Z'))).toBe(false);
  });

  it('opens exactly at the opening instant', () => {
    // The boundary is inclusive: a schedule set to open at 09:00 PHT is open at
    // 09:00:00, not from 09:00:01.
    expect(isScheduleOpen(WINDOW, new Date(OPENS))).toBe(true);
  });

  it('is already closed at the closing instant', () => {
    // Exclusive at the top, so a window and its immediate successor cannot both
    // be open for the one shared millisecond.
    expect(isScheduleOpen(WINDOW, new Date(CLOSES))).toBe(false);
  });

  // ---- Failing closed --------------------------------------------------
  // Every one of these is a half-configured or corrupt state. The pages stay
  // HIDDEN in all of them: a deploy that loses the schedule must not throw the
  // storefront open to everyone.

  it('is closed when no schedule has ever been configured', () => {
    expect(isScheduleOpen({ opensAt: null, closesAt: null }, new Date())).toBe(false);
  });

  it('is closed when only the opening time is set', () => {
    expect(isScheduleOpen({ opensAt: OPENS, closesAt: null }, new Date('2026-08-06T04:00:00.000Z'))).toBe(false);
  });

  it('is closed when only the closing time is set', () => {
    expect(isScheduleOpen({ opensAt: null, closesAt: CLOSES }, new Date('2026-08-06T04:00:00.000Z'))).toBe(false);
  });

  it('is closed when the stored value is not a date', () => {
    expect(isScheduleOpen({ opensAt: 'sometime next week', closesAt: CLOSES }, new Date('2026-08-06T04:00:00.000Z'))).toBe(false);
  });

  it('is closed when the window runs backwards', () => {
    // closes before it opens — an admin typo, not a window. Treating it as open
    // "between" the two would leave the pages live indefinitely.
    expect(isScheduleOpen({ opensAt: CLOSES, closesAt: OPENS }, new Date('2026-08-06T04:00:00.000Z'))).toBe(false);
  });

  it('is closed when the window has zero length', () => {
    expect(isScheduleOpen({ opensAt: OPENS, closesAt: OPENS }, new Date(OPENS))).toBe(false);
  });
});

describe('PHT conversion', () => {
  it('reads an admin datetime-local entry as Philippine time, not as UTC', () => {
    // The single most likely bug in this feature: the admin types 09:00 meaning
    // 9am Manila, and the server stores 9am UTC — five in the afternoon here.
    expect(phtLocalToIso('2026-08-04T09:00')).toBe(OPENS);
  });

  it('round-trips a stored instant back into the same local entry', () => {
    expect(isoToPhtLocal(OPENS)).toBe('2026-08-04T09:00');
  });

  it('keeps the Manila date when the UTC date is the day before', () => {
    // 2026-08-04T01:00Z is still Aug 4 in Manila, but 2026-08-03T17:00Z is
    // already Aug 4 there — the case a naive slice of the ISO string gets wrong.
    expect(isoToPhtLocal('2026-08-03T17:00:00.000Z')).toBe('2026-08-04T01:00');
  });

  it('converts a late-evening Manila time back across the UTC date boundary', () => {
    expect(phtLocalToIso('2026-08-04T23:30')).toBe('2026-08-04T15:30:00.000Z');
  });

  it('yields no instant for an empty or unparseable entry', () => {
    expect(phtLocalToIso('')).toBeNull();
    expect(phtLocalToIso('not a date')).toBeNull();
  });

  it('yields an empty entry for a missing stored instant', () => {
    expect(isoToPhtLocal(null)).toBe('');
    expect(isoToPhtLocal('garbage')).toBe('');
  });

  it('does not shift with the season — Philippine time has no daylight saving', () => {
    // January and August must convert with the same +08:00 offset. A conversion
    // built on the *server's* local timezone would drift here.
    expect(phtLocalToIso('2026-01-15T09:00')).toBe('2026-01-15T01:00:00.000Z');
    expect(phtLocalToIso('2026-08-15T09:00')).toBe('2026-08-15T01:00:00.000Z');
  });

  it('formats an instant for display in Philippine time', () => {
    const shown = formatPht(OPENS);
    expect(shown).toContain('2026');
    expect(shown).toMatch(/9:00|09:00/);
  });

  it('formats a missing instant as an explicit blank rather than "Invalid Date"', () => {
    expect(formatPht(null)).toBe('—');
    expect(formatPht('garbage')).toBe('—');
  });
});
