// The quick controls over the ONE shared Group Buy + Hatian window.
//
// The datetime fields on the settings card are the precise path: they say
// exactly when both boards trade. These are the fast path — open today, close
// now — for an admin who knows what they want and should not have to work out
// what "now" is in a picker to say it.
//
// Every control here produces a whole window, never half of one, because a
// half-set window reads as CLOSED everywhere downstream: a convenience button
// that wrote one end would take the storefront dark as a side effect of an edit
// that looked like it succeeded. They are pure functions of (window, now) so
// the card, a test and any future caller all get the same answer, and so the
// state a control writes can be checked against isScheduleOpen itself rather
// than against a second opinion about the rules.
import { isScheduleOpen, type GroupBuySchedule } from './schedule';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * What the window is doing at `now`.
 *
 * `unset` is kept distinct from `closed` because they need different things
 * from the admin: a closed window ran its course, an unset one is the state a
 * lost or never-written schedule leaves behind — both boards shut with nothing
 * on screen to say why. A corrupt window (backwards, zero-length, unparseable
 * ends) reads as `closed`, which is how the storefront gate reads it.
 */
export type ScheduleState = 'open' | 'scheduled' | 'closed' | 'unset';

export type ScheduleStatus = {
  state: ScheduleState;
  /**
   * Milliseconds until the next transition — the close when open, the opening
   * when scheduled. Null when nothing is due to happen.
   */
  msUntil: number | null;
};

/** Milliseconds for a stored end, or null when absent or unparseable. */
function instantOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function scheduleStatus(schedule: GroupBuySchedule, now: Date): ScheduleStatus {
  const opens = instantOf(schedule.opensAt);
  const closes = instantOf(schedule.closesAt);
  // A window missing either end is not a window. Reported as unset rather than
  // closed so the card can tell the admin there is nothing configured, which is
  // the state that needs a decision.
  if (opens === null || closes === null) return { state: 'unset', msUntil: null };

  const at = now.getTime();
  // Delegated rather than re-derived: "open" on this card must mean exactly what
  // the gate lets through, including the inclusive opening and exclusive close.
  if (isScheduleOpen(schedule, now)) return { state: 'open', msUntil: closes - at };
  // Only a well-formed window can still be ahead of us. A backwards or
  // zero-length one never opens, so it is closed and stays closed.
  if (opens < closes && at < opens) return { state: 'scheduled', msUntil: opens - at };
  return { state: 'closed', msUntil: null };
}

/**
 * A window that opens at this instant and runs for `days`.
 *
 * The preset behind "open for 7 days". Whole days from `now` rather than to the
 * end of a calendar day: an admin pressing this at 9am means seven days of
 * trading, not six and a bit.
 */
export function windowOpeningNow(days: number, now: Date): GroupBuySchedule {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('A window must run for at least a day.');
  }
  return {
    opensAt: now.toISOString(),
    closesAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
  };
}

/**
 * A scheduled window brought forward to start now, keeping its planned close.
 *
 * Refuses anything that would write a window the server rejects — there is no
 * close to keep if the schedule is unset, and moving the opening past a close
 * that has already passed stores a backwards window. Both cases would surface
 * to the admin as a failed save, which is right, but failing here keeps the
 * reason specific instead of returning a validation error from the API.
 */
export function windowStartedNow(schedule: GroupBuySchedule, now: Date): GroupBuySchedule {
  const closes = instantOf(schedule.closesAt);
  if (closes === null) throw new Error('There is no configured window to start.');
  if (now.getTime() >= closes) throw new Error('That window has already closed.');
  return { opensAt: now.toISOString(), closesAt: schedule.closesAt };
}

/**
 * The window as it should be stored once the admin closes both boards now.
 *
 * An open window is truncated to this instant, which keeps the record of when
 * it opened. Anything else is cleared, because truncating a window that has not
 * started yet stores a close before its opening — a backwards window the server
 * refuses, so "Close now" would report an error while leaving the boards due to
 * open on schedule. Clearing is the same instruction the admin gives by
 * emptying both fields, and it always leaves the boards shut.
 */
export function windowClosedNow(schedule: GroupBuySchedule, now: Date): GroupBuySchedule {
  const opens = instantOf(schedule.opensAt);
  // Strictly after: closing at the very instant a window opened would store a
  // zero-length window, which reads as closed but is refused on the way in.
  if (opens !== null && now.getTime() > opens && scheduleStatus(schedule, now).state === 'open') {
    return { opensAt: schedule.opensAt, closesAt: now.toISOString() };
  }
  return { opensAt: null, closesAt: null };
}

/**
 * An interval as an admin reads it: "2d 14h", "14h 3m", "3m".
 *
 * Coarsens by one unit as it grows — nobody schedules to the minute a week out,
 * and the minutes on their own are what matter in the last hour. An elapsed or
 * sub-minute interval says so in words rather than counting down to "0m", which
 * reads as closed while both boards are still trading.
 */
export function formatTimeLeft(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE_MS) return 'under a minute';
  if (ms >= DAY_MS) {
    const days = Math.floor(ms / DAY_MS);
    return `${days}d ${Math.floor((ms - days * DAY_MS) / HOUR_MS)}h`;
  }
  if (ms >= HOUR_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    return `${hours}h ${Math.floor((ms - hours * HOUR_MS) / MINUTE_MS)}m`;
  }
  return `${Math.floor(ms / MINUTE_MS)}m`;
}
