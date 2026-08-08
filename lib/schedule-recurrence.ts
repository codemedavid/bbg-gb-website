// The weekly window Group Buy and Hatian both trade in.
//
// The business states the schedule as four things — opening day, opening time,
// closing day, closing time — and this module is the only place that turns them
// into instants. Absolute windows (lib/schedule.ts) answered "are we open"; this
// answers "which cycle is this", which is the question the packing fee turns on:
// a fee is charged once per cycle, so a cycle needs an identity, and that
// identity is its opening instant.
//
// Everything here is a pure function of (recurrence, instant). The same weekly
// rule is read by a route handler, the admin card and the checkout, and each of
// those would otherwise grow its own slightly different arithmetic.
//
// Two rules are worth stating out loud because they are what the business
// actually asked for and neither falls out of the arithmetic on its own:
//
//   1. Closing on the SAME weekday it opens means a full week. "Opens
//      Wednesday, closes Wednesday" is a seven-day cycle, never a few hours —
//      even when the closing time is later in the day than the opening one.
//   2. Every day and time is Philippine time, resolved through lib/schedule.ts
//      so there is exactly one timezone conversion in the codebase.
import { phtCalendarDate, phtLocalToIso } from './schedule';

/** A weekday as JavaScript counts them: 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ScheduleRecurrence = {
  openDay: number | null;
  /** 'HH:mm' in Philippine time, or null when never configured. */
  openTime: string | null;
  closeDay: number | null;
  closeTime: string | null;
};

/** One occurrence of the weekly window, as absolute instants. */
export type Cycle = { opensAt: string; closesAt: string };

const DAYS_IN_WEEK = 7;

// Zero-padded 24-hour time. Deliberately strict: '9:00' is refused rather than
// repaired, because a recurrence this module cannot read exactly is one the
// admin should be shown as invalid, not one that quietly opens an hour out.
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type Resolved = { openDay: number; openTime: string; closeDay: number; closeTime: string };

const asWeekday = (value: number | null | undefined): number | null =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < DAYS_IN_WEEK
    ? (value as number)
    : null;

const asTime = (value: string | null | undefined): string | null =>
  typeof value === 'string' && TIME.test(value) ? value : null;

/**
 * The recurrence as four usable values, or null.
 *
 * Every half-configured or corrupt state resolves to null and therefore reads as
 * CLOSED downstream — an absent recurrence, a half-set one, a day outside the
 * week, an unparseable time. A deploy that loses the schedule must not throw
 * both boards open to everyone, which is the same posture isScheduleOpen takes.
 */
function resolve(r: ScheduleRecurrence): Resolved | null {
  const openDay = asWeekday(r.openDay);
  const closeDay = asWeekday(r.closeDay);
  const openTime = asTime(r.openTime);
  const closeTime = asTime(r.closeTime);
  if (openDay === null || closeDay === null || openTime === null || closeTime === null) return null;
  return { openDay, openTime, closeDay, closeTime };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

type CalendarDate = { year: number; month: number; day: number };

/**
 * A Manila calendar date shifted by whole days, as the date half of a
 * `datetime-local` entry.
 *
 * Plain calendar arithmetic with no timezone in it: the shift happens on the
 * civil date, and the instant is solved for afterwards by phtLocalToIso. Adding
 * `days * 86_400_000` to an instant instead is the standard way to land an hour
 * out the moment a zone ever shifts.
 */
function shiftedDate(base: CalendarDate, days: number): string {
  const at = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** The instant `days` from a Manila date, at a Philippine wall-clock time. */
function instantAt(base: CalendarDate, days: number, time: string): string | null {
  return phtLocalToIso(`${shiftedDate(base, days)}T${time}`);
}

/**
 * How many days a cycle runs.
 *
 * Rule 1 lives here: a closing weekday equal to the opening one is a full week,
 * not a zero-length window and not a same-day one. Every other pairing is the
 * first occurrence of the closing weekday after the opening.
 */
function spanDays(openDay: number, closeDay: number): number {
  const delta = (closeDay - openDay + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  return delta === 0 ? DAYS_IN_WEEK : delta;
}

/**
 * The cycle that opened at `opensAt`, or null if its close cannot be resolved.
 *
 * A cycle NEVER outlasts the start of the next one. An admin who sets a closing
 * time later in the day than the opening time on the same weekday — 9:00 AM to
 * 6:00 PM Wednesday — describes a window that would still be running when the
 * following Wednesday opens, and two overlapping cycles make "which cycle was
 * this packing fee paid in" a question with two answers. Clamping keeps the
 * boards continuously open, which is what that admin asked for, while keeping
 * one instant in exactly one cycle.
 */
function cycleFrom(r: Resolved, opensAt: string): Cycle | null {
  const openedOn = phtCalendarDate(new Date(opensAt));
  const closesAt = instantAt(openedOn, spanDays(r.openDay, r.closeDay), r.closeTime);
  const nextOpensAt = instantAt(openedOn, DAYS_IN_WEEK, r.openTime);
  if (!closesAt || !nextOpensAt) return null;
  return {
    opensAt,
    closesAt: Date.parse(closesAt) > Date.parse(nextOpensAt) ? nextOpensAt : closesAt,
  };
}

/**
 * The most recent cycle to have opened at or before `now` — which may already
 * have closed. Whether it is still running is cycleAt's question, not this one's.
 */
function cycleOpenedBy(r: Resolved, now: Date): Cycle | null {
  const today = phtCalendarDate(now);
  const back = (today.weekday - r.openDay + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  const candidate = instantAt(today, -back, r.openTime);
  if (!candidate) return null;
  // The opening weekday can be today with its time still ahead of us, in which
  // case the cycle we are in opened a week ago.
  const opensAt = Date.parse(candidate) > now.getTime()
    ? instantAt(today, -back - DAYS_IN_WEEK, r.openTime)
    : candidate;
  return opensAt ? cycleFrom(r, opensAt) : null;
}

/**
 * The cycle running at `now`, or null when both boards are closed.
 *
 * Opening instant inclusive, closing instant exclusive — the same boundaries
 * isScheduleOpen uses, so one cycle and its successor never overlap for a
 * shared millisecond and a fee cannot be attributed to two cycles at once.
 */
export function cycleAt(r: ScheduleRecurrence, now: Date): Cycle | null {
  const resolved = resolve(r);
  if (!resolved) return null;
  const cycle = cycleOpenedBy(resolved, now);
  if (!cycle) return null;
  const at = now.getTime();
  return at >= Date.parse(cycle.opensAt) && at < Date.parse(cycle.closesAt) ? cycle : null;
}

/** Whether both boards are trading at `now`. */
export function isRecurrenceOpen(r: ScheduleRecurrence, now: Date): boolean {
  return cycleAt(r, now) !== null;
}

/**
 * The next cycle to OPEN after `now`.
 *
 * Strictly after, so asking this mid-cycle answers "the one after this" rather
 * than the window already running — an admin's countdown would otherwise read
 * "opens in 0m" while the boards are live.
 */
export function nextCycle(r: ScheduleRecurrence, now: Date): Cycle | null {
  const resolved = resolve(r);
  if (!resolved) return null;
  const prior = cycleOpenedBy(resolved, now);
  if (!prior) return null;
  const openedOn = phtCalendarDate(new Date(prior.opensAt));
  const opensAt = instantAt(openedOn, DAYS_IN_WEEK, resolved.openTime);
  return opensAt ? cycleFrom(resolved, opensAt) : null;
}

/**
 * The identity of a cycle: the instant it opened.
 *
 * Stored on every order placed in the cycle, which is what makes "one packing
 * fee per cycle" a lookup rather than a guess. The opening instant rather than
 * a week number because it survives an admin moving the schedule: the cycle a
 * fee was paid in keeps its name even after the recurrence changes.
 */
export function cycleKeyOf(cycle: Cycle): string {
  return cycle.opensAt;
}
