// Where a customer's browser is sent to see a file.
//
// signedUrl() answers "give me a URL that works", and under the ImageKit driver
// — which is production — that is an ik.imagekit.io URL. The image still
// renders inside the page, but the URL belongs to somebody else: tapping it,
// opening it in a new tab, or sharing it takes a customer off bbgph.org and
// onto a CDN host they have never heard of. Reviews and COAs are the two
// galleries built to be opened and looked at, so both must stay on the site.
//
// The tests below run under STORAGE_DRIVER=local (vitest.config.ts), where
// signedUrl already returns a relative path — so a test that merely asserted
// the current shape would pass while production did the opposite. The driver is
// forced to 'imagekit' here for exactly that reason.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/env', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/env')>();
  return { ...real, env: { ...real.env, storageDriver: 'imagekit' } };
});

const { PUBLIC_BUCKETS, isPublicBucket, siteFileUrl } = await import('./file-url');
const { BUCKETS } = await import('@/lib/env');
const { serializeFeedbackItem } = await import('./feedback');

describe('which buckets a logged-out visitor may read', () => {
  it('publishes the galleries built to be looked at', () => {
    expect(isPublicBucket(BUCKETS.feedback)).toBe(true);
    expect(isPublicBucket(BUCKETS.coa)).toBe(true);
  });

  // The one that must never drift. Payment proofs are screenshots of people's
  // bank apps; the file route guards them with requireSession today, and the
  // whole point of opening buckets up is that it must not open THAT one.
  it('keeps payment proofs private', () => {
    expect(isPublicBucket(BUCKETS.proofs)).toBe(false);
    expect([...PUBLIC_BUCKETS]).not.toContain(BUCKETS.proofs);
  });

  it('keeps a bucket nobody named private', () => {
    expect(isPublicBucket('some-new-bucket')).toBe(false);
  });
});

describe('siteFileUrl', () => {
  it('points at this site, not at a storage host', () => {
    const url = siteFileUrl('feedback', 'abc-123.png');
    expect(url).toBe('/api/files/feedback/abc-123.png');
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toMatch(/imagekit/i);
  });

  it('escapes a key with a space so the browser requests the right file', () => {
    expect(siteFileUrl('coa', 'batch 7.pdf')).toBe('/api/files/coa/batch%207.pdf');
  });
});

// The behaviour the customer actually sees.
describe('a review image under the production storage driver', () => {
  it('is served from bbgph.org, not from ImageKit', async () => {
    const serialized = await serializeFeedbackItem({
      id: 'item-1', folderId: 'folder-1', imageKey: 'abc-123.png',
      caption: null, customerName: null, isActive: true, sortOrder: 0,
    });

    expect(serialized.imageUrl).toBe('/api/files/feedback/abc-123.png');
    expect(serialized.imageUrl).not.toMatch(/imagekit/i);
  });
});
