// Time-scheduled opening — the pure rules, shared by both boards.
//
// A Kahati counter and a Group Buy batch answer the same two questions, so they
// answer them here rather than each on its own. There is still no scheduler in
// this app: 'scheduled' is a stored status that the lazy sweeps flip to 'open'
// once `opensAt` has passed (lib/kahati-server.ts, lib/moq-batch-server.ts).
export type OpeningStatus = 'open' | 'scheduled';

// The status a row should carry when it is written. An absent open date means
// "now" — the overwhelmingly common case, and the behaviour every existing row
// already has. A date behind us is also now: storing it as scheduled would park
// the row waiting on a sweep to undo the admin's own click.
export function openingStatus(opensAt: Date | null, now: Date = new Date()): OpeningStatus {
  if (!opensAt) return 'open';
  return opensAt.getTime() > now.getTime() ? 'scheduled' : 'open';
}

// Why the admin's window is not a window, or null if it is one. Opening at or
// after the close is a row that goes on the board and comes straight back off,
// having accepted nothing — worth refusing at the boundary rather than letting
// the sweep quietly resolve it a moment after it appears.
export function scheduleWindowError(opensAt: Date | null, closesAt: Date | null): string | null {
  if (!opensAt || !closesAt) return null;
  if (opensAt.getTime() >= closesAt.getTime()) {
    return 'The open date must be before the close date.';
  }
  return null;
}

// The same check over the ISO strings the API and the admin forms exchange.
// Both callers hold strings, and parsing in two places is how the two ends of
// one rule drift apart.
export function scheduleWindowErrorFromIso(
  opensAt: string | null | undefined,
  closesAt: string | null | undefined,
): string | null {
  return scheduleWindowError(
    opensAt ? new Date(opensAt) : null,
    closesAt ? new Date(closesAt) : null,
  );
}
