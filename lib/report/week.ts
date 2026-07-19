// Week math for the weekly order report. Weeks run Monday–Sunday and are anchored
// to Philippine time (Asia/Manila, fixed +08:00, no DST), so the same order always
// lands in the same week regardless of where the server runs.
//
// A "week" is identified by its Monday as a YYYY-MM-DD string. Helpers are pure and
// take an explicit `now` where the current date matters, so they are deterministic.

const PH_OFFSET = '+08:00';
const DAY_MS = 86_400_000;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Format a UTC-midnight Date back to YYYY-MM-DD. */
function toYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Parse YYYY-MM-DD into a Date at UTC midnight (used only for calendar math). */
function fromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Validate a YYYY-MM-DD string (rejects overflow like 2026-13-40). */
export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  // Date.UTC silently normalizes overflow, so confirm the parts round-trip.
  return fromYmd(ymd) instanceof Date && toYmd(fromYmd(ymd)) === ymd;
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(ymd: string, days: number): string {
  return toYmd(new Date(fromYmd(ymd).getTime() + days * DAY_MS));
}

/** The Monday (YYYY-MM-DD) of the week containing the given calendar date. */
export function mondayOf(ymd: string): string {
  const d = fromYmd(ymd);
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7; // Mon→0, Sun→6
  return toYmd(new Date(d.getTime() - backToMonday * DAY_MS));
}

/** The Manila calendar date (YYYY-MM-DD) for an instant. */
export function manilaYmd(now: Date): string {
  // Shift the instant into Manila local time, then read its UTC calendar parts.
  return toYmd(new Date(now.getTime() + 8 * 3600_000));
}

/** Monday of the most recent *fully completed* Mon–Sun week, relative to `now`. */
export function mostRecentFullWeekMonday(now: Date): string {
  return addDays(mondayOf(manilaYmd(now)), -7);
}

/** N recent week-Mondays, newest first, ending with the most recent full week. */
export function recentWeekMondays(now: Date, count = 8): string[] {
  const first = mostRecentFullWeekMonday(now);
  return Array.from({ length: count }, (_, i) => addDays(first, -7 * i));
}

/** Half-open UTC instant bounds [Mon 00:00 PH, next Mon 00:00 PH) for filtering. */
export function weekBounds(mondayYmd: string): { start: Date; end: Date } {
  return {
    start: new Date(`${mondayYmd}T00:00:00${PH_OFFSET}`),
    end: new Date(`${addDays(mondayYmd, 7)}T00:00:00${PH_OFFSET}`),
  };
}

/** ISO-8601 week number of the week identified by its Monday. */
export function isoWeekNumber(mondayYmd: string): number {
  // The Thursday of the same week determines the ISO week's owning year.
  const thursday = fromYmd(addDays(mondayYmd, 3));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.ceil(((thursday.getTime() - yearStart) / DAY_MS + 1) / 7);
}

/** "Mon May 25 – Sun May 31" */
export function formatRange(mondayYmd: string): string {
  const mon = fromYmd(mondayYmd);
  const sun = fromYmd(addDays(mondayYmd, 6));
  const fmt = (d: Date) => `${WEEKDAY_SHORT[d.getUTCDay()]} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${fmt(mon)} – ${fmt(sun)}`;
}

/** Dropdown label, e.g. "Week 21 · Mon May 25 – Sun May 31". */
export function weekOptionLabel(mondayYmd: string): string {
  return `Week ${isoWeekNumber(mondayYmd)} · ${formatRange(mondayYmd)}`;
}

/** Download filename, e.g. "BBG-Week-2026-05-25.pdf". */
export function weekFilename(mondayYmd: string): string {
  return `BBG-Week-${mondayYmd}.pdf`;
}
