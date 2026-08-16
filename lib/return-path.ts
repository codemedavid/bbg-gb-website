// Where to send someone after they log in.
//
// The order emails link straight at /orders/<id>, which needs a session. A
// customer reading that mail on a phone days later usually has none, so the app
// bounces them to /login?next=/orders/<id> and brings them back here afterwards.
//
// That `next` comes out of the URL, which means an attacker writes it as easily
// as we do. Handing it to the router unchecked turns the login screen into an
// open redirect: the victim types a password on our real page and is then
// dropped on someone else's. So this is an allowlist by shape — our own paths,
// nothing that can name another host — and anything unrecognised degrades to
// the home page rather than being repaired into something almost-safe.

/** Where a login with no usable `next` lands. */
export const DEFAULT_AFTER_LOGIN = '/';

/**
 * The path to navigate to after login, or `DEFAULT_AFTER_LOGIN` if `raw` is
 * missing or is anything we would not navigate to ourselves.
 *
 * Rejects, in order: absent values; anything not rooted at '/'; the two
 * spellings of a protocol-relative URL ('//host' and '/\host'), which start
 * with a slash but address another origin; whitespace and control characters,
 * which no genuine link needs and which hide the real target from a human
 * reading it; and a return trip to /login itself, which would show the form
 * again to someone who has just filled it in.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return DEFAULT_AFTER_LOGIN;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_AFTER_LOGIN;
  if ([...raw].some((ch) => ch.charCodeAt(0) <= 32 || ch.charCodeAt(0) === 127)) return DEFAULT_AFTER_LOGIN;
  // Exact page only: '/login-help' is a different page and stays allowed.
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login#') || raw.startsWith('/login/')) {
    return DEFAULT_AFTER_LOGIN;
  }
  return raw;
}
