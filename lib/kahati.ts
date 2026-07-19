// Hatian (kahati) counter lifecycle — pure helpers, no I/O.
//
// A hatian counter fills exactly one kit: KAHATI_MAX_VIALS (10) vials. On reaching
// the cap it closes early and a fresh sibling counter auto-opens.
//
// The cap is not the success condition. A hatian only needs KAHATI_MIN_VIABLE_VIALS
// (7) by its deadline to be worth ordering: 7-10 vials is "Good to Go" and closes,
// under 7 is cancelled and every participant is refunded (see lib/kahati-server.ts).
import { KAHATI_MAX_VIALS, KAHATI_MIN_VIABLE_VIALS } from './pricing';

export { KAHATI_MAX_VIALS, KAHATI_MIN_VIABLE_VIALS };

// A hatian is full once its claimed vials reach the cap. `>=` (not `===`) so a
// counter can never be treated as "still open" after an over-count edit.
export function isKahatiFull(claimedSlots: number, totalSlots: number): boolean {
  return claimedSlots >= totalSlots;
}

// A hatian is worth ordering once it reaches the minimum, even if the kit never
// filled. This is the "Good to Go" threshold, distinct from isKahatiFull, which
// marks the cap at which the counter closes early and a sibling opens.
export function isKahatiViable(claimedSlots: number): boolean {
  return claimedSlots >= KAHATI_MIN_VIABLE_VIALS;
}

// Terminal status for an OPEN hatian whose deadline has passed:
//   >= 7 vials -> 'closed'    (viable; proceeds to fulfillment)
//   <  7 vials -> 'cancelled' (batch never ordered; participants are refunded)
// The cap is deliberately not consulted: 7-9 vials is a success, not a shortfall.
export function resolveExpiredKahatiStatus(claimedSlots: number): 'closed' | 'cancelled' {
  return isKahatiViable(claimedSlots) ? 'closed' : 'cancelled';
}

// Fill percentage (0-100) for the progress bar. Clamped at both ends and
// guarded against a zero cap, which would otherwise render as NaN and collapse
// the bar to an empty element.
export function kahatiProgressPercent(claimedSlots: number, totalSlots: number): number {
  if (!(totalSlots > 0)) return 0;
  const pct = Math.round((claimedSlots / totalSlots) * 100);
  return Math.min(100, Math.max(0, pct));
}

export type KahatiStatus = 'open' | 'closed' | 'shipped' | 'completed' | 'cancelled';

// Board badge for a hatian. It counts toward the 7-vial minimum rather than the
// cap, because that is the number that decides whether the batch gets ordered at
// all — "2 MORE TO GO" tells a customer their join actually matters.
export function kahatiBadge(status: KahatiStatus, claimedSlots: number, totalSlots: number): string {
  if (status !== 'open') return 'CLOSED';
  if (claimedSlots >= totalSlots) return 'FULL';
  if (isKahatiViable(claimedSlots)) return 'GOOD TO GO';
  if (claimedSlots <= 0) return 'OPEN';
  // A hatian whose cap is below the minimum can never be viable; fall back to the cap.
  const needed = Math.min(KAHATI_MIN_VIABLE_VIALS, totalSlots) - claimedSlots;
  return `${needed} MORE TO GO`;
}

// Deadline for an auto-opened sibling: the same window length as its parent,
// measured from `now`. A parent with no deadline yields a sibling with none.
// A parent already past its deadline yields a zero-length window (closes at now),
// clamped so the window is never negative.
export function nextKahatiClosesAt(
  createdAt: Date,
  closesAt: Date | null,
  now: Date,
): Date | null {
  if (!closesAt) return null;
  const windowMs = Math.max(closesAt.getTime() - createdAt.getTime(), 0);
  return new Date(now.getTime() + windowMs);
}
