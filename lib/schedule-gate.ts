// The gate every Group Buy and Hatian surface goes through.
//
// The requirement is not "each board has a schedule" — it is that there is ONE
// schedule and neither board can be live without the other. That only holds if
// there is one function to ask, so these three are it. A route that grows its
// own `if (open)` is how the two boards drift apart.
import { ApiError, getSession } from '@/lib/session';
import { isGroupBuyOpenNow } from '@/lib/settings';

// A closed board is indistinguishable from one that never existed: 404 rather
// than 403, so a closed window does not advertise what it is hiding.
const CLOSED = 'Not found.';

/** A public board. Hidden outright while the window is shut. */
export async function requireBoardsOpen(): Promise<void> {
  if (await isGroupBuyOpenNow()) return;
  throw new ApiError(404, CLOSED);
}

/**
 * A board whose endpoint the admin screens also read.
 *
 * The admin campaign list reads the PUBLIC GET /api/campaigns, so gating that
 * naively locks the admin out of their own campaigns the moment the storefront
 * closes — they could never open the next window. Admins read through; being
 * merely signed in is not enough.
 */
export async function requireBoardsOpenOrAdmin(): Promise<void> {
  if (await isGroupBuyOpenNow()) return;
  const session = await getSession();
  if (session?.role === 'admin') return;
  throw new ApiError(404, CLOSED);
}

/**
 * The rule, as opposed to its presentation. A cart left open across the close
 * must not still check out just because the customer already had the page.
 * 409 rather than 404: the request is well-formed and the resource exists — it
 * conflicts with the state of the schedule.
 */
export async function requireCommitmentsOpen(): Promise<void> {
  if (await isGroupBuyOpenNow()) return;
  throw new ApiError(409, 'Group Buy and Hatian are closed. Please wait for the next scheduled window.');
}
