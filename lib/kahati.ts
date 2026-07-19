// Hatian (kahati) counter lifecycle — pure helpers, no I/O.
//
// A hatian counter fills exactly one kit: KAHATI_MAX_VIALS (10) vials. On reaching
// the cap it closes and a fresh sibling counter auto-opens. If the close deadline
// passes before the cap is reached, the counter is cancelled instead.
import { KAHATI_MAX_VIALS } from './pricing';

export { KAHATI_MAX_VIALS };

// A hatian is full once its claimed vials reach the cap. `>=` (not `===`) so a
// counter can never be treated as "still open" after an over-count edit.
export function isKahatiFull(claimedSlots: number, totalSlots: number): boolean {
  return claimedSlots >= totalSlots;
}

// Terminal status for an OPEN hatian whose deadline has passed:
//   full  -> 'closed'    (kit complete, proceeds to fulfillment)
//   short -> 'cancelled' (never reached the cap)
export function resolveExpiredKahatiStatus(
  claimedSlots: number,
  totalSlots: number,
): 'closed' | 'cancelled' {
  return isKahatiFull(claimedSlots, totalSlots) ? 'closed' : 'cancelled';
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

// Board badge for a hatian. The thresholds are expressed as fractions of the cap
// because the cap is one kit (10 vials) — the previous `remaining <= 10` test was
// always true at that size, so every counter read "N VIALS LEFT".
export function kahatiBadge(status: KahatiStatus, claimedSlots: number, totalSlots: number): string {
  if (status !== 'open') return 'CLOSED';
  const remaining = Math.max(0, totalSlots - claimedSlots);
  if (remaining === 0) return 'FULL';
  if (remaining <= Math.max(1, Math.round(totalSlots * 0.25))) {
    return `${remaining} ${remaining === 1 ? 'VIAL' : 'VIALS'} LEFT`;
  }
  if (claimedSlots >= totalSlots / 2) return 'FILLING FAST';
  return 'OPEN';
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
