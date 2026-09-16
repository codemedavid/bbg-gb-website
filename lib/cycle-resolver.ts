// Which cycle the boards are in, when a cycle can come from EITHER the weekly
// schedule (lib/schedule-recurrence.ts) or an admin starting one by hand.
//
// The recurrence answers "which cycle does the calendar say we are in". A cycle
// an admin starts is a cycle too — it opens the boards, it names the orders
// placed in it, it is the one the admin works afterwards — and the two have to
// be reconciled in exactly one place, or the gate, the checkout and the admin
// screens each decide differently who is open.
//
// The rule is short: THE NEWEST CYCLE TO HAVE OPENED WINS. A manual cycle
// started on a Thursday outranks a schedule that says "dark until Saturday";
// on Saturday the schedule opens a cycle that started later still, and that
// one wins. A manual cycle started INSIDE a scheduled one outranks it from that
// instant — which is what "end this cycle early and start the next" means.
//
// A pause closes whichever cycle is current. It does not un-name it: the
// admin is still working that cycle's orders while the boards are dark.
//
// Everything here is a pure function of (state, now). Storage is
// lib/settings.ts's business.
import {
  cycleAt, cycleKeyOf, latestCycle, nextCycle, type Cycle, type ScheduleRecurrence,
} from './schedule-recurrence';

export type CycleSource = 'schedule' | 'manual';

/** A cycle, and where it came from — so a card can say "started by hand". */
export type ResolvedCycle = Cycle & { source: CycleSource };

/** Everything the resolution depends on, as lib/settings.ts reads it. */
export type ScheduleState = {
  recurrence: ScheduleRecurrence;
  /** The cycle an admin last started by hand, or null if never. */
  manual: Cycle | null;
  pausedUntil: string | null;
};

const DAY_MS = 86_400_000;

/**
 * How long a manual cycle runs when there is no schedule to hand back to.
 *
 * A week, because that is the rhythm the business trades at; without a bound
 * a cycle started once would leave the boards open for good.
 */
export const MANUAL_CYCLE_DEFAULT_MS = 7 * DAY_MS;

const instantOf = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The manual cycle an admin starts at `now`.
 *
 * It opens now. It closes when the schedule next takes over — at the running
 * cycle's own close when started mid-cycle (ending a cycle early must not
 * lengthen the window), at the next scheduled opening when the boards were
 * dark, and after MANUAL_CYCLE_DEFAULT_MS when there is no schedule at all.
 */
export function manualCycleFrom(recurrence: ScheduleRecurrence, now: Date): Cycle {
  const opensAt = now.toISOString();
  const running = cycleAt(recurrence, now);
  if (running) return { opensAt, closesAt: running.closesAt };
  const next = nextCycle(recurrence, now);
  if (next) return { opensAt, closesAt: next.opensAt };
  return { opensAt, closesAt: new Date(now.getTime() + MANUAL_CYCLE_DEFAULT_MS).toISOString() };
}

/** A stored manual cycle that has actually opened by `now`, or null. */
function manualOpenedBy(manual: Cycle | null, now: Date): Cycle | null {
  const opens = instantOf(manual?.opensAt);
  const closes = instantOf(manual?.closesAt);
  if (!manual || opens === null || closes === null) return null;
  return opens <= now.getTime() ? manual : null;
}

/**
 * The most recent cycle to have opened at or before `now`, from either source,
 * running or not. The cycle the admin is WORKING.
 */
export function latestCycleOf(state: ScheduleState, now: Date): ResolvedCycle | null {
  const scheduled = latestCycle(state.recurrence, now);
  const manual = manualOpenedBy(state.manual, now);
  if (!scheduled && !manual) return null;
  if (!manual) return { ...scheduled!, source: 'schedule' };
  if (!scheduled) return { ...manual, source: 'manual' };
  return Date.parse(manual.opensAt) >= Date.parse(scheduled.opensAt)
    ? { ...manual, source: 'manual' }
    : { ...scheduled, source: 'schedule' };
}

/**
 * The cycle customers may trade in at `now`, or null when the boards are dark.
 *
 * Opening instant inclusive, closing exclusive — the same boundaries the
 * recurrence uses, so a manual cycle and the scheduled one that follows it
 * never share a millisecond.
 */
export function currentCycleOf(state: ScheduleState, now: Date): ResolvedCycle | null {
  const latest = latestCycleOf(state, now);
  if (!latest) return null;
  const at = now.getTime();
  if (at < Date.parse(latest.opensAt) || at >= Date.parse(latest.closesAt)) return null;
  const pausedUntil = instantOf(state.pausedUntil);
  if (pausedUntil !== null && at < pausedUntil) return null;
  return latest;
}

export { cycleKeyOf };
