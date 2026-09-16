// Maps a failed checkout response to the message the customer should actually see.
//
// The order API answers a missing upload backend (lib/storage.ts) with a 503
// whose text names STORAGE_DRIVER and IMAGEKIT_* — deploy configuration that is
// meaningful to an admin but only alarming to a buyer. Replace it with a
// reassuring, retryable line. Stock and validation failures (400) are already
// written for the customer, so they pass through unchanged.
const GENERIC = 'Could not place order. Please try again.';
const UPLOADS_UNAVAILABLE =
  'We couldn’t process your payment proof right now. Please try again in a few minutes.';

export function friendlyCheckoutError(status: number, serverMessage: string): string {
  if (status === 401) return 'Your session has expired. Sign in again to place your order. Your cart is saved.';
  if (status === 413) return 'These payment proofs are too large to send together. Attach smaller proof images or PDFs and try again.';
  if (status === 503) return UPLOADS_UNAVAILABLE;
  return serverMessage || GENERIC;
}

// A 400 that names a cart line the shop can no longer sell — a delisted
// product, a deleted hatian, or one that closed while the cart sat open.
// The cart persists in localStorage, so such a line loops the same rejection
// on every retry until it is removed; the checkout page uses this to drop the
// dead line instead. Quantity/stock shortfalls deliberately do NOT match:
// the customer can fix those by editing the quantity.
export type StaleCheckoutLine = { refId: string } | { kahatiName: string };

// Every rejection naming a line the shop can no longer sell ends `: <refId>`,
// so one pattern covers them all. A new one must be added here as well as
// thrown — a 400 the cart cannot match is a 400 it loops forever.
const STALE_BY_REF = new RegExp(
  '^(?:' + [
    'Product not available',
    'MOQ product not available',
    'Group buy not found',            // a deleted hatian
    'Campaign not found',             // a deleted group buy batch
    'Group buy no longer accepting commitments', // cancelled or approved by the admin
  ].join('|') + '): (\\S+)$',
);
const STALE_KAHATI = /^Kahati "(.+)" (?:is already closed|has already closed)/;
// A line refused because its product left that sales channel — the admin
// un-ticked Group Buy or Kahati on the product, or delisted it outright
// (lib/product-channels.ts channelRefusal). Same shape as the prefixes above:
// the id is what the cart needs, the sentence before it is what a log reader
// needs. A channel refusal is permanent for that line, so the cart drops it.
const STALE_CHANNEL = / is not available through .+: (\S+)$/;

// A closed kahati that also carries its id. Checked before the name-only
// pattern: counters are re-seeded under the same name, so a name match can
// drop the customer's NEW line for the listing that replaced the dead one.
const STALE_KAHATI_BY_REF = /^Kahati ".+" (?:is already closed|has already closed)[^:]*: (\S+)$/;

export function staleCheckoutLine(serverMessage: string): StaleCheckoutLine | null {
  const byRef = STALE_BY_REF.exec(serverMessage);
  if (byRef) return { refId: byRef[1] };
  const kahatiByRef = STALE_KAHATI_BY_REF.exec(serverMessage);
  if (kahatiByRef) return { refId: kahatiByRef[1] };
  const byChannel = STALE_CHANNEL.exec(serverMessage);
  if (byChannel) return { refId: byChannel[1] };
  const kahati = STALE_KAHATI.exec(serverMessage);
  if (kahati) return { kahatiName: kahati[1] };
  return null;
}

export type UnavailableCheckoutLine = { refId: string; name: string };

/**
 * Every dead cart line a checkout refusal lists in `data.unavailable`
 * (lib/checkout-preflight.ts), so the page can drop them all in one go instead
 * of one per failed attempt.
 *
 * The body is untrusted input and this decides what gets DELETED from a cart,
 * so an entry without a string refId is skipped rather than guessed at.
 */
export function unavailableCheckoutLines(body: unknown): UnavailableCheckoutLine[] {
  const listed = (body as { data?: { unavailable?: unknown } } | null)?.data?.unavailable;
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((entry) => {
    const { refId, name } = (entry ?? {}) as { refId?: unknown; name?: unknown };
    if (typeof refId !== 'string' || refId.length === 0) return [];
    return [{ refId, name: typeof name === 'string' ? name : '' }];
  });
}

// The suffix the cart appends to a kahati line's name (components/JoinSheet.tsx).
// Stripped before comparing, because the server names the counter and the cart
// names the line, and those two strings differ by exactly this.
const KAHATI_SUFFIX = ' — kahati';

/**
 * Is this cart line the one the server refused?
 *
 * Lives here rather than inline in the checkout page so the matching rule is
 * testable on its own — it decides which line gets DELETED from a customer's
 * cart, which is the most destructive thing that screen does.
 *
 * The kahati branch matches the name EXACTLY. It used to use startsWith, and
 * kahati counters are named after the peptide they carry, so "Retatrutide 10mg"
 * is a prefix of "Retatrutide 10mg (Batch 2)" and of "Retatrutide 10mg XL" — a
 * customer holding two of them could have the wrong one silently removed, and
 * be told by the toast that they had lost the other. An exact match can only
 * ever fail safe: the worst case is a line that stays and shows its own refusal
 * again, which is recoverable, rather than one that vanishes, which is not.
 *
 * Matching by name at all is forced by the server's message — a closed kahati is
 * named for the customer's benefit, not by id. Every other refusal ends in the
 * refId and matches on that.
 */
export function matchesStaleLine(
  line: { kind: string; refId: string; name: string },
  stale: StaleCheckoutLine,
): boolean {
  if ('refId' in stale) return line.refId === stale.refId;
  if (line.kind !== 'group_buy') return false;
  const bare = line.name.endsWith(KAHATI_SUFFIX)
    ? line.name.slice(0, -KAHATI_SUFFIX.length)
    : line.name;
  return bare === stale.kahatiName;
}
