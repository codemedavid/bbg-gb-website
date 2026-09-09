// Where a customer's browser is sent to see a file.
//
// signedUrl() (lib/storage.ts) answers a different question: "give me a URL
// that works". Under the ImageKit driver, which is production, that is an
// ik.imagekit.io URL. The image still renders inside the page, but the URL
// belongs to somebody else — tapping it, opening it in a new tab or sharing it
// takes a customer off bbgph.org and onto a CDN host they have never heard of.
//
// Reviews and COAs are the two galleries built to be opened and looked at, so
// both are served through this site instead. That is not a rendering detail: a
// COA is the document that says the product was third-party tested, and a link
// to it has to look like it came from us.
//
// Pure: a string in, a string out, and one set. It consults no driver on
// purpose — that is the whole point, since the driver is what was leaking the
// host.
import { BUCKETS } from '@/lib/env';

/**
 * Buckets any visitor may read, logged in or not.
 *
 * An allowlist, never a denylist. Payment proofs are screenshots of people's
 * bank apps, and the difference between "these two are public" and "everything
 * except proofs is public" is one forgotten bucket away from publishing them.
 * A bucket nobody named here stays private.
 */
export const PUBLIC_BUCKETS: ReadonlySet<string> = new Set<string>([
  // Customer testimonials: marketing material the storefront shows to anyone.
  BUCKETS.feedback,
  // Certificates of analysis: the third-party test results, which are the whole
  // reason a customer trusts the batch. Useless behind a login.
  BUCKETS.coa,
]);

export const isPublicBucket = (bucket: string): boolean => PUBLIC_BUCKETS.has(bucket);

/**
 * This site's own URL for a stored file.
 *
 * Relative, so it is correct on production, on a preview deployment and on
 * localhost without anything having to know which of those it is.
 *
 * encodeURI rather than encodeURIComponent: a storage key may contain slashes
 * that are real path separators, and escaping those would ask the route for a
 * file whose name contains "%2F".
 */
export const siteFileUrl = (bucket: string, key: string): string =>
  `/api/files/${bucket}/${encodeURI(key)}`;
