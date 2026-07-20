// Which orders the success screen names after checkout.
//
// A mixed cart checks out as one order per mode, so the redirect carries the
// primary invoice in the path and any siblings in a `more` query param. Kept
// separate from the page so the parsing is testable on its own — the page around
// it is plain JSX, this is where a mistake would actually cost the customer.

export function successOrderNos(primary: string, moreParam: string | null): string[] {
  const siblings = (moreParam ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Deduped: a double-encoded redirect can repeat the primary in the siblings,
  // and showing the same invoice twice reads as a double charge.
  return [...new Set([primary, ...siblings])];
}
