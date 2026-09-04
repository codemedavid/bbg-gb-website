// A money formatter must never invent a price.
//
// The reported bug: "some product prices occasionally display as ₱0". Not an
// attack, not caching, not hydration — `php()` answered EVERY unusable input
// with the string '₱0'. undefined, null, NaN, '', 'abc', {} and [] all rendered
// as a real-looking, believable, wrong price.
//
// That guard was added for a good reason: the formatter used to throw on
// undefined and took a whole admin page down with it. But the two options were
// never "crash" or "lie" — a formatter can say it does not know. ₱0 is a price
// a customer can act on; "—" is not, which is the entire point.
//
// The class matters more than any one call site. Because the fallback lived
// inside the shared formatter, a dropped field, a renamed key or a failed
// request rendered as a price on every screen at once, and nothing anywhere
// could tell the difference between free and broken.
import { describe, it, expect } from 'vitest';
import { php, PRICE_UNAVAILABLE, isDisplayablePrice } from '@/lib/format';

describe('php() with a real amount', () => {
  it('formats whole pesos without decimals', () => {
    expect(php(1200)).toBe('₱1,200');
  });

  it('formats centavos with two decimals', () => {
    expect(php(1200.5)).toBe('₱1,200.50');
  });

  it('reads a numeric string, which is how the database returns money', () => {
    expect(php('1200.50')).toBe('₱1,200.50');
  });

  it('formats a genuine zero as ₱0', () => {
    // A real, known zero is still a real answer — a waived packing fee, a
    // settled balance. Only the UNKNOWN must stop rendering as this.
    expect(php(0)).toBe('₱0');
    expect(php('0')).toBe('₱0');
  });
});

describe('php() with a value it cannot price', () => {
  // Each of these reached a customer as '₱0' before.
  const unusable: [string, unknown][] = [
    ['undefined — an absent field on an API response', undefined],
    ['null — a nullable price column', null],
    ['NaN — a failed arithmetic', NaN],
    ['an empty string', ''],
    ['a non-numeric string', 'abc'],
    ['an object — a response shape that changed', {}],
    ['an array', []],
    ['Infinity — a division by zero', Infinity],
  ];

  for (const [what, value] of unusable) {
    it(`says the price is unavailable for ${what}`, () => {
      expect(php(value as number)).toBe(PRICE_UNAVAILABLE);
    });
  }

  it('never renders an unusable value as a zero price', () => {
    // Stated separately and bluntly: this is the regression.
    for (const [, value] of unusable) {
      expect(php(value as number)).not.toBe('₱0');
    }
  });

  it('does not throw, whatever it is handed', () => {
    // The reason the ₱0 fallback existed. Keep the crash fixed while fixing
    // the lie — a formatter is still never worth a blank screen.
    for (const [, value] of unusable) {
      expect(() => php(value as number)).not.toThrow();
    }
  });
});

describe('isDisplayablePrice', () => {
  it('lets a caller refuse to sell what it cannot price', () => {
    // The other half of the client's requirement: "DO NOT display ₱0 and DO NOT
    // allow checkout". A screen needs to ask the question before it renders a
    // buy button, not just format a string.
    expect(isDisplayablePrice(550)).toBe(true);
    expect(isDisplayablePrice(0)).toBe(true);
    expect(isDisplayablePrice('550.00')).toBe(true);

    expect(isDisplayablePrice(undefined)).toBe(false);
    expect(isDisplayablePrice(null)).toBe(false);
    expect(isDisplayablePrice(NaN)).toBe(false);
    expect(isDisplayablePrice('')).toBe(false);
    expect(isDisplayablePrice('abc')).toBe(false);
  });
});
