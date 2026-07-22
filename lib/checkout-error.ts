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
