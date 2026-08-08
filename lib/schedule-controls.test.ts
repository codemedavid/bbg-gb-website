// What the shared Group Buy + Hatian schedule is DOING, as the admin card reads
// it back.
//
// The recurrence itself is pinned in lib/schedule-recurrence.test.ts. This is
// the layer above it: given the cycle that resolved and whether a pause is in
// force, which of the four things is true right now, and how long until it
// changes. Kept pure so the card, a test and any future caller all get the same
// answer, and so the state can be checked against the gate's own rule rather
// than a second opinion about it.
import { describe, it, expect } from 'vitest';
import { scheduleStatus, formatTimeLeft } from '@/lib/schedule-controls';

// Opens Wed Aug 5 2026 8:00 PM PHT, closes Wed Aug 12 6:00 PM PHT.
const CYCLE = { opensAt: '2026-08-05T12:00:00.000Z', closesAt: '2026-08-12T10:00:00.000Z' };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('scheduleStatus', () => {
  it('is open inside the cycle, counting down to the close', () => {
    // Arrange — one day before the close.
    const now = new Date(Date.parse(CYCLE.closesAt) - DAY);

    // Act
    const status = scheduleStatus({ cycle: CYCLE, pausedUntil: null }, now);

    // Assert
    expect(status).toEqual({ state: 'open', msUntil: DAY });
  });

  it('is scheduled before the cycle opens, counting down to the opening', () => {
    const now = new Date(Date.parse(CYCLE.opensAt) - 2 * HOUR);

    const status = scheduleStatus({ cycle: CYCLE, pausedUntil: null }, now);

    expect(status).toEqual({ state: 'scheduled', msUntil: 2 * HOUR });
  });

  it('is unset when no schedule has ever been configured', () => {
    // Kept distinct from closed: an unset schedule is the state a lost or
    // never-written recurrence leaves behind — both boards shut with nothing on
    // screen to say why — and it is the one that needs a decision from the admin.
    const status = scheduleStatus({ cycle: null, pausedUntil: null }, new Date());

    expect(status).toEqual({ state: 'unset', msUntil: null });
  });

  it('is paused while a pause is in force, counting down to its end', () => {
    // A pause outranks an open cycle: the admin closed the boards by hand and
    // the card must say so, not report the window they are inside.
    const now = new Date(Date.parse(CYCLE.opensAt) + HOUR);
    const pausedUntil = new Date(now.getTime() + 3 * HOUR).toISOString();

    const status = scheduleStatus({ cycle: CYCLE, pausedUntil }, now);

    expect(status).toEqual({ state: 'paused', msUntil: 3 * HOUR });
  });

  it('ignores a pause that has already elapsed', () => {
    const now = new Date(Date.parse(CYCLE.opensAt) + HOUR);
    const pausedUntil = new Date(now.getTime() - MINUTE).toISOString();

    expect(scheduleStatus({ cycle: CYCLE, pausedUntil }, now).state).toBe('open');
  });

  it('ignores an unparseable pause rather than reporting the boards paused forever', () => {
    const now = new Date(Date.parse(CYCLE.opensAt) + HOUR);

    expect(scheduleStatus({ cycle: CYCLE, pausedUntil: 'whenever' }, now).state).toBe('open');
  });

  it('reports a pause even with no cycle resolved', () => {
    // Paused outranks unset too: the admin needs to know the pause is the
    // reason before they go looking for a schedule that is fine.
    const pausedUntil = new Date(Date.now() + HOUR).toISOString();

    expect(scheduleStatus({ cycle: null, pausedUntil }, new Date()).state).toBe('paused');
  });
});

describe('formatTimeLeft', () => {
  // Coarsens by one unit as it grows — nobody schedules to the minute a week
  // out, and the minutes on their own are what matter in the last hour.
  it('reads in days and hours beyond a day', () => {
    expect(formatTimeLeft(2 * DAY + 14 * HOUR)).toBe('2d 14h');
  });

  it('reads in hours and minutes within a day', () => {
    expect(formatTimeLeft(14 * HOUR + 3 * MINUTE)).toBe('14h 3m');
  });

  it('reads in minutes within an hour', () => {
    expect(formatTimeLeft(3 * MINUTE)).toBe('3m');
  });

  it('says so in words below a minute', () => {
    // Counting down to "0m" reads as closed while both boards are still trading.
    expect(formatTimeLeft(30_000)).toBe('under a minute');
  });

  it('says so in words for an elapsed interval', () => {
    expect(formatTimeLeft(-1)).toBe('under a minute');
  });
});
