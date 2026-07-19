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
