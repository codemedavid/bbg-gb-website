// The dashboard's date filter, shared by the picker and the route that serves it.
//
// Both ends have to agree on what a usable range is, and — more to the point —
// on what to say when it is not one. Two copies of that rule drift: the picker
// would happily send a backwards range the route then rejects with different
// words, and the admin would read two explanations for one mistake.
import { isValidYmd } from './report/week';

/** An inclusive Manila-calendar range, as the two YYYY-MM-DD values a picker holds. */
export type StatsRange = { from: string; to: string };

/**
 * Why this pair cannot be used as a range, or null when it can.
 *
 * A half-filled pair is an error rather than an open-ended filter: "everything
 * since 10 August" and "everything up to 10 August" are different questions,
 * and silently picking one of them would put a number on screen that answers
 * neither.
 */
export function statsRangeError(from: string, to: string): string | null {
  if (!from || !to) return 'Pick both a start and an end date to filter the dashboard.';
  if (!isValidYmd(from) || !isValidYmd(to)) return 'Dates must be written as YYYY-MM-DD.';
  if (to < from) return 'The end date must be on or after the start date.';
  return null;
}
