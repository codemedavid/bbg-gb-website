// What the ONE shared Group Buy + Hatian schedule is doing, right now.
//
// The recurrence (lib/schedule-recurrence.ts) decides which cycle we are in;
// this decides how that reads to an admin, and it is deliberately a pure
// function of (resolved state, now) so the card, a test and any future caller
// all get the same answer. The state a control writes can then be checked
// against the recurrence itself rather than against a second opinion about the
// rules.
import type { Cycle } from './schedule-recurrence';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * What the schedule is doing at `now`.
 *
 * `unset` is kept distinct from `scheduled` because they need different things
 * from the admin: a scheduled cycle is about to open on its own, an unset
 * schedule is the state a lost or never-written recurrence leaves behind — both
 * boards shut with nothing on screen to say why.
 *
 * `paused` is the admin's own doing, and it outranks everything else: they
 * closed the boards by hand, and a card reporting the window they are inside
 * would send them looking for a fault in a schedule that is fine.
 */
export type ScheduleState = 'open' | 'scheduled' | 'paused' | 'unset';

export type ScheduleStatus = {
  state: ScheduleState;
  /**
   * Milliseconds until the next transition — the close when open, the opening
   * when scheduled, the end of the pause when paused. Null when nothing is due.
   */
  msUntil: number | null;
};

/** The resolved schedule as the settings API hands it over. */
export type ResolvedSchedule = {
  /** The running cycle, or the next one when the boards are dark. Null if unset. */
  cycle: Cycle | null;
  pausedUntil: string | null;
};

/** Milliseconds for a stored instant, or null when absent or unparseable. */
function instantOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function scheduleStatus(resolved: ResolvedSchedule, now: Date): ScheduleStatus {
  const at = now.getTime();

  // A pause that cannot be read is not a pause. Failing closed is right for a
  // missing schedule; doing it here would let one corrupt row keep the
  // storefront dark indefinitely, which is the harder fault to notice.
  const pausedUntil = instantOf(resolved.pausedUntil);
  if (pausedUntil !== null && at < pausedUntil) {
    return { state: 'paused', msUntil: pausedUntil - at };
  }

  const opens = instantOf(resolved.cycle?.opensAt);
  const closes = instantOf(resolved.cycle?.closesAt);
  if (opens === null || closes === null) return { state: 'unset', msUntil: null };

  // Same boundaries the gate uses — inclusive opening, exclusive close — so
  // "open" on this card means exactly what customers can reach.
  if (at >= opens && at < closes) return { state: 'open', msUntil: closes - at };
  if (at < opens) return { state: 'scheduled', msUntil: opens - at };
  // A cycle entirely behind us can only mean the caller handed over a stale
  // one; the recurrence always has a next.
  return { state: 'unset', msUntil: null };
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
