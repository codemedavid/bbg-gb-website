// The chat links in the header are only as good as the URLs behind them: a
// wa.me address with a "+" in it 404s, and a viber:// address without one
// opens a chat with the wrong country. Both are built here, once.
import { describe, it, expect } from 'vitest';
import { SUPPORT_PHONE, whatsappUrl, viberUrl } from './contact';

describe('support phone number', () => {
  it('is the number BBG answers on, in a form a customer can read', () => {
    expect(SUPPORT_PHONE).toBe('+63 991 446 2762');
  });
});

describe('whatsappUrl', () => {
  it('addresses wa.me with digits only — no plus, no spaces', () => {
    expect(whatsappUrl('+63 991 446 2762')).toBe('https://wa.me/639914462762');
  });

  it('defaults to the BBG support number', () => {
    expect(whatsappUrl()).toBe('https://wa.me/639914462762');
  });

  it('tolerates a number written with dashes and parentheses', () => {
    expect(whatsappUrl('(+63) 991-446-2762')).toBe('https://wa.me/639914462762');
  });
});

describe('viberUrl', () => {
  it('keeps the country code as an escaped plus, which is what Viber matches on', () => {
    expect(viberUrl('+63 991 446 2762')).toBe('viber://chat?number=%2B639914462762');
  });

  it('defaults to the BBG support number', () => {
    expect(viberUrl()).toBe('viber://chat?number=%2B639914462762');
  });
});
