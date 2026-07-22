import { describe, it, expect } from 'vitest';
import { friendlyCheckoutError } from '@/lib/checkout-error';

// The order API's upload-config failure (lib/storage.ts) is a 503 whose message
// names STORAGE_DRIVER / IMAGEKIT_* — deploy jargon that means nothing to a
// buyer. friendlyCheckoutError decides what the customer actually sees.
describe('friendlyCheckoutError', () => {
  it('replaces the technical upload-config 503 with a reassuring, retryable message', () => {
    const technical =
      'File uploads are not configured: STORAGE_DRIVER=imagekit but IMAGEKIT_PRIVATE_KEY '
      + 'and/or IMAGEKIT_URL_ENDPOINT are missing.';
    const msg = friendlyCheckoutError(503, technical);
    expect(msg).not.toContain('STORAGE_DRIVER');
    expect(msg).not.toContain('IMAGEKIT');
    expect(msg).toMatch(/try again/i);
  });

  it('passes an actionable stock/validation message straight through', () => {
    expect(friendlyCheckoutError(400, 'Only 1 left in stock.')).toBe('Only 1 left in stock.');
  });

  it('falls back to a generic message when the server supplies none', () => {
    expect(friendlyCheckoutError(500, '')).toMatch(/could not place order/i);
  });
});
