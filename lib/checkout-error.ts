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

export function staleCheckoutLine(serverMessage: string): StaleCheckoutLine | null {
  const byRef = STALE_BY_REF.exec(serverMessage);
  if (byRef) return { refId: byRef[1] };
  const kahati = STALE_KAHATI.exec(serverMessage);
  if (kahati) return { kahatiName: kahati[1] };
  return null;
}
