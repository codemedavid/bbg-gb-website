// The one schedule that opens and closes Group Buy and Hatian together.
//
// A window is two absolute instants, stored as ISO strings. Everything here is a
// pure function of (window, instant): the question "are we open right now" gets
// asked from a route handler, a server component and the nav bar, and each of
// those would otherwise grow its own slightly different comparison.
//
// There is no cron and no stored "currently open" flag. Every read resolves the
// window afresh, so an admin's edit takes effect on the next request rather than
// at the next tick of something that has to still be running.
//
// Every displayed and entered time is Philippine Standard Time. The conversion
// goes through Intl with an explicit timeZone rather than adding eight hours or
// reading the host clock: a hardcoded offset is a bug waiting for the zone to
// change, and the host clock means the window moves with wherever the app is
// deployed.
import { MANILA_TZ } from './timezone';

export { MANILA_TZ };

export type GroupBuySchedule = {
  /** ISO-8601 instant, or null when never configured. */
  opensAt: string | null;
  closesAt: string | null;
};

/** Milliseconds for a stored value, or null when absent or unparseable. */
function instantOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Is the storefront open at `now`?
 *
 * Opening instant inclusive, closing instant exclusive — a window set to close
 * at 23:59 is shut at 23:59, and a window cannot overlap its own successor for
 * one shared millisecond.
 *
 * Every half-configured or corrupt state reads as CLOSED: an absent window, a
 * half-set one, an unparseable value, a window that runs backwards, and a
 * zero-length one. A deploy that loses the schedule must not throw the
 * storefront open to everyone, and an admin's typo is not a window.
 */
export function isScheduleOpen(schedule: GroupBuySchedule, now: Date): boolean {
  const opens = instantOf(schedule.opensAt);
  const closes = instantOf(schedule.closesAt);
  if (opens === null || closes === null) return false;
  // Rejects backwards and zero-length in one comparison.
  if (!(opens < closes)) return false;
  const at = now.getTime();
  return at >= opens && at < closes;
}

// Built once — constructing a DateTimeFormat is the expensive part of this
// module, and a storefront request may resolve several windows.
const manilaFields = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

type ManilaFields = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function manilaFieldsAt(at: Date): ManilaFields {
  const parts = manilaFields.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'), month: get('month'), day: get('day'),
    // en-US with hour12:false renders midnight as '24' in some ICU versions;
    // the modulo keeps it at the start of the day it belongs to.
    hour: get('hour') % 24, minute: get('minute'), second: get('second'),
  };
}

/**
 * The Manila calendar date at an instant, with its weekday (0 = Sunday).
 *
 * The weekday is derived from the Manila date rather than read off the Date,
 * because 2026-08-05T17:00Z is Wednesday in UTC and already Thursday here — a
 * weekly schedule keyed off the UTC weekday opens on the wrong day twice a week.
 */
export function phtCalendarDate(at: Date): { year: number; month: number; day: number; weekday: number } {
  const f = manilaFieldsAt(at);
  return {
    year: f.year, month: f.month, day: f.day,
    weekday: new Date(Date.UTC(f.year, f.month - 1, f.day)).getUTCDay(),
  };
}

/** Manila's offset from UTC at a given instant, in milliseconds. */
function manilaOffsetMs(at: Date): number {
  const f = manilaFieldsAt(at);
  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asIfUtc - at.getTime();
}

const LOCAL_ENTRY = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/**
 * An admin's `datetime-local` entry, read as Philippine time.
 *
 * This is the single most likely bug in the feature: the admin types 09:00
 * meaning 9am Manila and the server stores 9am UTC — five in the afternoon here.
 *
 * The instant is solved for rather than assumed: guess that the entry is UTC,
 * ask what Manila's offset is around that guess, and subtract it. The result is
 * verified by converting back, which rejects both an impossible date (month 13,
 * 31 February) and any instant that does not actually render as the entry.
 *
 * Returns null for an empty or unparseable entry — a missing time is a real
 * state (the window is unset), not an error.
 */
export function phtLocalToIso(local: string): string | null {
  const m = LOCAL_ENTRY.exec(local.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(guess)) return null;
  const at = new Date(guess - manilaOffsetMs(new Date(guess)));
  // Round-trip check: catches a rolled-over date and any offset we solved wrong.
  if (isoToPhtLocal(at.toISOString()) !== `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`) {
    return null;
  }
  return at.toISOString();
}

/**
 * A stored instant as the `datetime-local` entry that produced it.
 *
 * Goes through Intl rather than slicing the ISO string: 2026-08-03T17:00Z is
 * already Aug 4 in Manila, and a slice would show the wrong day. A missing or
 * unparseable instant yields an empty entry, which is what an empty input is.
 */
export function isoToPhtLocal(iso: string | null): string {
  const ms = instantOf(iso);
  if (ms === null) return '';
  const f = manilaFieldsAt(new Date(ms));
  return `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}`;
}

const manilaDisplay = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA_TZ, dateStyle: 'medium', timeStyle: 'short',
});

/**
 * An instant as an admin should read it, in Philippine time. A missing or
 * corrupt instant renders as an explicit blank rather than "Invalid Date",
 * which is the string a half-configured schedule would otherwise put on screen.
 */
export function formatPht(iso: string | null): string {
  const ms = instantOf(iso);
  if (ms === null) return '—';
  return manilaDisplay.format(new Date(ms));
}
