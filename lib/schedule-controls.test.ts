// The quick controls over the ONE shared Group Buy + Hatian window.
//
// Every one of these produces a window that lib/settings.ts will accept and
// lib/schedule.ts will read back the same way. That is the whole risk here: a
// convenience button that writes a window the server rejects is an admin
// pressing "Close now" and staying open, and a button that writes a window
// which reads as half-set takes BOTH boards dark as a side effect.
//
// So the controls are pure functions of (window, now) and are pinned against
// isScheduleOpen itself rather than against a second opinion about the rules.
import { describe, it, expect } from 'vitest';
import { isScheduleOpen, type GroupBuySchedule } from './schedule';
import {
  scheduleStatus, windowOpeningNow, windowStartedNow, windowClosedNow, formatTimeLeft,
} from './schedule-controls';

const at = (iso: string): Date => new Date(iso);
const DAY_MS = 86_400_000;

// Aug 4 09:00 PHT through Aug 11 23:59 PHT, the shape the card already stores.
const OPENS = '2026-08-04T01:00:00.000Z';
const CLOSES = '2026-08-11T15:59:00.000Z';
const WINDOW: GroupBuySchedule = { opensAt: OPENS, closesAt: CLOSES };
const UNSET: GroupBuySchedule = { opensAt: null, closesAt: null };

describe('scheduleStatus', () => {
  it('reports an in-force window as open, with the time until it closes', () => {
    const now = at('2026-08-09T01:59:00.000Z'); // 2d 14h before it closes

    const status = scheduleStatus(WINDOW, now);

    expect(status.state).toBe('open');
    expect(status.msUntil).toBe(Date.parse(CLOSES) - now.getTime());
  });

  it('reports a window that has not started as scheduled, with the time until it opens', () => {
    const now = at('2026-08-03T01:00:00.000Z');

    const status = scheduleStatus(WINDOW, now);

    expect(status.state).toBe('scheduled');
    expect(status.msUntil).toBe(Date.parse(OPENS) - now.getTime());
  });

  it('reports an elapsed window as closed', () => {
    expect(scheduleStatus(WINDOW, at('2026-08-12T00:00:00.000Z')).state).toBe('closed');
  });

  it('reports a window with no configuration as unset, not merely closed', () => {
    // The two differ for the admin: "unset" is the state that needs a decision,
    // and it is the one that quietly shuts both boards after a deploy.
    expect(scheduleStatus(UNSET, at('2026-08-09T00:00:00.000Z')).state).toBe('unset');
  });

  it('treats a half-set window as unset, the way the storefront reads it', () => {
    const half: GroupBuySchedule = { opensAt: OPENS, closesAt: null };

    expect(scheduleStatus(half, at('2026-08-09T00:00:00.000Z')).state).toBe('unset');
  });

  it('reads a backwards window as closed, agreeing with isScheduleOpen', () => {
    const backwards: GroupBuySchedule = { opensAt: CLOSES, closesAt: OPENS };
    const now = at('2026-08-09T00:00:00.000Z');

    expect(scheduleStatus(backwards, now).state).toBe('closed');
    expect(isScheduleOpen(backwards, now)).toBe(false);
  });

  it('agrees with isScheduleOpen at the exact opening and closing instants', () => {
    // Opening inclusive, closing exclusive — the boundary the gate uses.
    const opening = at(OPENS);
    const closing = at(CLOSES);

    expect(scheduleStatus(WINDOW, opening).state).toBe('open');
    expect(isScheduleOpen(WINDOW, opening)).toBe(true);
    expect(scheduleStatus(WINDOW, closing).state).toBe('closed');
    expect(isScheduleOpen(WINDOW, closing)).toBe(false);
  });
});

describe('windowOpeningNow', () => {
  it('opens at this instant and closes the requested number of days later', () => {
    const now = at('2026-08-06T05:30:00.000Z');

    const next = windowOpeningNow(7, now);

    expect(next.opensAt).toBe('2026-08-06T05:30:00.000Z');
    expect(next.closesAt).toBe(new Date(now.getTime() + 7 * DAY_MS).toISOString());
  });

  it('produces a window that is open right away', () => {
    const now = at('2026-08-06T05:30:00.000Z');

    expect(isScheduleOpen(windowOpeningNow(3, now), now)).toBe(true);
  });

  it('refuses a non-positive duration, which would store a window nobody can use', () => {
    const now = at('2026-08-06T05:30:00.000Z');

    expect(() => windowOpeningNow(0, now)).toThrow();
    expect(() => windowOpeningNow(-1, now)).toThrow();
  });
});

describe('windowStartedNow', () => {
  it('brings a scheduled window forward, keeping its planned close', () => {
    const now = at('2026-08-03T01:00:00.000Z'); // a day before it was due to open

    const next = windowStartedNow(WINDOW, now);

    expect(next.opensAt).toBe(now.toISOString());
    expect(next.closesAt).toBe(CLOSES);
    expect(isScheduleOpen(next, now)).toBe(true);
  });

  it('refuses to start a window whose close has already passed', () => {
    // Moving the opening past the close writes a backwards window, which the
    // server rejects and the storefront reads as shut.
    const now = at('2026-08-12T00:00:00.000Z');

    expect(() => windowStartedNow(WINDOW, now)).toThrow();
  });

  it('refuses to start a window that is not configured', () => {
    expect(() => windowStartedNow(UNSET, at('2026-08-09T00:00:00.000Z'))).toThrow();
  });
});

describe('windowClosedNow', () => {
  it('ends an open window at this instant, keeping when it opened', () => {
    const now = at('2026-08-09T01:59:00.000Z');

    const next = windowClosedNow(WINDOW, now);

    expect(next.opensAt).toBe(OPENS);
    expect(next.closesAt).toBe(now.toISOString());
    expect(isScheduleOpen(next, now)).toBe(false);
  });

  it('clears a window that has not started yet rather than truncating it', () => {
    // Truncating a future window stores closesAt before opensAt — a backwards
    // window the server refuses, so "Close now" would report an error while
    // leaving the boards due to open on schedule.
    const now = at('2026-08-03T01:00:00.000Z');

    expect(windowClosedNow(WINDOW, now)).toEqual(UNSET);
  });

  it('clears a window being closed at the very instant it opened', () => {
    // Truncating here stores a zero-length window, which reads as closed but is
    // refused on the way in.
    expect(windowClosedNow(WINDOW, at(OPENS))).toEqual(UNSET);
  });

  it('leaves the boards closed when there was no window to begin with', () => {
    expect(windowClosedNow(UNSET, at('2026-08-09T00:00:00.000Z'))).toEqual(UNSET);
  });

  it('closes an already-elapsed window without reopening anything', () => {
    const now = at('2026-08-12T00:00:00.000Z');

    expect(isScheduleOpen(windowClosedNow(WINDOW, now), now)).toBe(false);
  });
});

describe('formatTimeLeft', () => {
  it('reads in days and hours once more than a day remains', () => {
    expect(formatTimeLeft(2 * DAY_MS + 14 * 3_600_000)).toBe('2d 14h');
  });

  it('reads in hours and minutes within the last day', () => {
    expect(formatTimeLeft(14 * 3_600_000 + 3 * 60_000)).toBe('14h 3m');
  });

  it('reads in minutes within the last hour', () => {
    expect(formatTimeLeft(3 * 60_000)).toBe('3m');
  });

  it('says less than a minute rather than counting down to 0m', () => {
    // "0m" reads as closed while the boards are still trading.
    expect(formatTimeLeft(30_000)).toBe('under a minute');
  });

  it('says less than a minute for an elapsed or negative interval', () => {
    expect(formatTimeLeft(0)).toBe('under a minute');
    expect(formatTimeLeft(-5_000)).toBe('under a minute');
  });
});
