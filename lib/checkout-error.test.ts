import { describe, it, expect } from 'vitest';
import { friendlyCheckoutError, staleCheckoutLine } from '@/lib/checkout-error';

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

// A cart can outlive its listings: the browser persists cart lines in
// localStorage, so a delisted product, a deleted hatian or one that closed
// while the tab was open produces a checkout 400 naming a line the shop can no
// longer sell. staleCheckoutLine recognizes those rejections so the checkout
// page can drop the dead line instead of looping the same failure — seen live
// as six identical 400s from a customer retrying against a stale cart.
describe('staleCheckoutLine', () => {
  it('extracts the refId from a delisted product rejection', () => {
    expect(staleCheckoutLine('Product not available: 123e4567-e89b-12d3-a456-426614174000'))
      .toEqual({ refId: '123e4567-e89b-12d3-a456-426614174000' });
  });

  it('extracts the refId from a delisted MOQ product rejection', () => {
    expect(staleCheckoutLine('MOQ product not available: abc-123'))
      .toEqual({ refId: 'abc-123' });
  });

  it('extracts the refId from a deleted hatian rejection', () => {
    expect(staleCheckoutLine('Group buy not found: abc-123')).toEqual({ refId: 'abc-123' });
  });

  it('recognizes a hatian that closed while the cart sat open', () => {
    expect(staleCheckoutLine('Kahati "Reta 20mg" is already closed.'))
      .toEqual({ kahatiName: 'Reta 20mg' });
    expect(staleCheckoutLine('Kahati "Reta 20mg" has already closed and is no longer accepting commitments.'))
      .toEqual({ kahatiName: 'Reta 20mg' });
  });

  it('leaves recoverable rejections alone — the customer can fix quantity themselves', () => {
    expect(staleCheckoutLine('Only 3 vials left in this kahati.')).toBeNull();
    expect(staleCheckoutLine('Only 2 left in stock for Tirzepatide 15mg.')).toBeNull();
    expect(staleCheckoutLine('Payment proof is required to place an order.')).toBeNull();
    expect(staleCheckoutLine('')).toBeNull();
  });
});
