// When a storefront page is open, as a weekly window in Philippine time.
//
// This is a pure function of (config, instant). There is no cron, no job and no
// stored "currently open" flag — every read resolves the window afresh, which is
// what makes an admin's edit take effect on the next request instead of at the
// next tick of something that has to be running. Nothing here can miss-fire,
// drift, or need restarting after a deploy.
//
// Every time is Philippine Standard Time. The resolver goes through Intl with an
// explicit timeZone rather than reading the host clock or adding 8 hours:
// Asia/Manila has been a flat UTC+8 since 1978, but a hardcoded offset is a bug
// waiting for that to change, and reading the host clock means the window moves
// with wherever the app happens to be deployed.
import { MANILA_TZ } from './timezone';

export { MANILA_TZ };

/** 0 = Sunday, matching Date#getDay. */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * A manual override in force. 'none' hands control back to the schedule — the
 * override is released, not merely set to agree with it, so releasing it is a
 * distinct act from setting it.
 */
export type PageScheduleOverride = 'none' | 'show' | 'hide';

export type PageSchedule = {
  /** Whether the weekly window governs visibility at all. */
  autoEnabled: boolean;
  /** The plain ON/OFF switch, consulted only while `autoEnabled` is false. */
  visible: boolean;
  override: PageScheduleOverride;
  openDay: WeekDay;
  /** 'HH:MM', 24-hour, Philippine time. */
  openTime: string;
  closeDay: WeekDay;
  closeTime: string;
};

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/**
 * What an unconfigured page is: visible, with the weekly window filled in but
 * not yet driving anything.
 *
 * Deliberately the opposite posture to the MOQ flag in lib/settings.ts, which
 * fails closed. /moq did not exist before its flag, so hiding was the safe
 * default there. /groupbuy and /kahati are live pages today: if an absent or
 * corrupt config hid them, shipping this feature — or one bad write — would take
 * two working storefront pages down. The window below is the business schedule,
 * ready for an admin to switch on.
 */
export const DEFAULT_PAGE_SCHEDULE: PageSchedule = {
  autoEnabled: false,
  visible: true,
  override: 'none',
  openDay: 3, openTime: '00:00',   // Wednesday 00:00 PHT
  closeDay: 6, closeTime: '12:00', // Saturday 12:00 PHT
};

const WEEKDAY_INDEX: Record<string, WeekDay> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

export const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

// Built once. Constructing a DateTimeFormat is the expensive part of this
// module, and every storefront request resolves at least one window.
const manilaParts = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA_TZ,
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Where an instant falls in the Philippine week: minutes since Sunday 00:00 PHT,
 * in [0, 10080).
 */
export function manilaWeekMinute(now: Date): number {
  const parts = manilaParts.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const day = WEEKDAY_INDEX[get('weekday')] ?? 0;
  // en-US with hour12:false renders midnight as '24' in some ICU versions; the
  // modulo keeps that at the start of the day it belongs to rather than pushing
  // it into the next one.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return day * MINUTES_PER_DAY + hour * 60 + minute;
}

/** 'HH:MM' as minutes past midnight; anything unparseable reads as 00:00. */
export function timeToMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return 0;
  const hours = Math.min(23, Number(m[1]));
  const minutes = Math.min(59, Number(m[2]));
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const m = ((Math.floor(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The configured window as week minutes. */
export function scheduleWindow(s: PageSchedule): { openMinute: number; closeMinute: number } {
  return {
    openMinute: s.openDay * MINUTES_PER_DAY + timeToMinutes(s.openTime),
    closeMinute: s.closeDay * MINUTES_PER_DAY + timeToMinutes(s.closeTime),
  };
}

/**
 * Is `nowMinute` inside the window? Opening minute inclusive, closing minute
 * exclusive — a page configured to shut at noon is shut at noon, not at 12:01.
 *
 * A window whose close precedes its open wraps the week boundary (Saturday noon
 * through Wednesday midnight is a real schedule, and Sunday is week minute 0).
 * An empty window — open equal to close — describes no boundary at all and reads
 * as always open, for the same reason the defaults do: an admin who left the
 * times alone must not thereby hide the page.
 */
export function isWithinWindow(openMinute: number, closeMinute: number, nowMinute: number): boolean {
  if (openMinute === closeMinute) return true;
  if (openMinute < closeMinute) return nowMinute >= openMinute && nowMinute < closeMinute;
  return nowMinute >= openMinute || nowMinute < closeMinute;
}

/** Why a page is open or closed — surfaced in the admin status badge. */
export type VisibilityReason = 'override' | 'schedule' | 'manual';
export type PageVisibility = { open: boolean; reason: VisibilityReason };

/**
 * Whether customers can see the page right now.
 *
 * Precedence is override → schedule → manual switch. The override wins outright
 * so an admin can accept late orders without editing a schedule the rest of the
 * week depends on; releasing it (back to 'none') resumes the schedule on the
 * very next read. With automatic scheduling off, the plain switch governs, which
 * is the MOQ page's behaviour exactly.
 */
export function resolvePageVisibility(s: PageSchedule, now: Date): PageVisibility {
  if (s.override === 'show') return { open: true, reason: 'override' };
  if (s.override === 'hide') return { open: false, reason: 'override' };
  if (!s.autoEnabled) return { open: s.visible, reason: 'manual' };
  const { openMinute, closeMinute } = scheduleWindow(s);
  return { open: isWithinWindow(openMinute, closeMinute, manilaWeekMinute(now)), reason: 'schedule' };
}

/**
 * When the schedule next flips the page, or null when the schedule is not the
 * thing deciding — an override is in force, automatic scheduling is off, or the
 * window has no boundary to cross. Null means "no scheduled change", which is
 * what a countdown must show rather than a moment that will not arrive.
 *
 * Minutes are added to the instant directly. That is exact here because
 * Asia/Manila has no DST; a zone that did would need the boundary rebuilt as a
 * local wall-clock time instead.
 */
export function nextTransition(s: PageSchedule, now: Date): Date | null {
  if (s.override !== 'none' || !s.autoEnabled) return null;
  const { openMinute, closeMinute } = scheduleWindow(s);
  if (openMinute === closeMinute) return null;

  const nowMinute = manilaWeekMinute(now);
  const target = isWithinWindow(openMinute, closeMinute, nowMinute) ? closeMinute : openMinute;
  // Distance forward around the week. A target equal to now is a full week away,
  // not zero: this instant's transition has already happened.
  const ahead = ((target - nowMinute) % MINUTES_PER_WEEK + MINUTES_PER_WEEK) % MINUTES_PER_WEEK
    || MINUTES_PER_WEEK;
  // Truncate to the minute first: the boundary lands on a whole PHT minute, and
  // carrying `now`'s seconds through would put the transition seconds late.
  const flooredNow = Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(flooredNow + ahead * 60_000);
}
