import { describe, it, expect } from 'vitest';
import { CATEGORIES, CATEGORY_DESC, PRODUCTS } from './catalog';

const slugs = new Set(CATEGORIES.map((c) => c.slug));

describe('catalog integrity', () => {
  it('every product references a defined category slug', () => {
    const orphans = PRODUCTS.filter((p) => !slugs.has(p.cat)).map((p) => p.name);
    expect(orphans).toEqual([]);
  });

  it('no duplicate non-empty product codes', () => {
    const codes = PRODUCTS.map((p) => p.code).filter((c) => c && c.trim());
    const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
    expect(dupes).toEqual([]);
  });

  it('every product has a positive PHP price', () => {
    const bad = PRODUCTS.filter((p) => !(p.pricePhp > 0)).map((p) => p.name);
    expect(bad).toEqual([]);
  });

  it('every category slug has a description', () => {
    const missing = CATEGORIES.filter((c) => !CATEGORY_DESC[c.slug]).map((c) => c.slug);
    expect(missing).toEqual([]);
  });
});

describe('aesthetics line (imported from price list)', () => {
  const aesthetics = PRODUCTS.filter((p) => p.cat === 'aesthetics');

  it('defines an aesthetics category', () => {
    expect(slugs.has('aesthetics')).toBe(true);
  });

  it('adds the aesthetics products (skin boosters, fillers, toxins)', () => {
    expect(aesthetics.length).toBeGreaterThanOrEqual(25);
  });

  it('includes iconic items from each aesthetics group', () => {
    const names = new Set(aesthetics.map((p) => p.name));
    for (const expected of ['Rejuran i', 'Profhilo', 'JUVEDERM Ultra 3', 'Nabota', 'Xeomin']) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it('prices aesthetics in PHP only (no USD, ready-to-use liquid arrival)', () => {
    for (const p of aesthetics) {
      expect(p.priceUsd == null).toBe(true);
      expect(p.arrival).toBe('salt_liquid');
      expect(p.pricePhp).toBeGreaterThan(0);
    }
  });
});
