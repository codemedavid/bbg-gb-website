// The MOQ shelf seed.
//
// The client named exactly three products for this page, so the seed is pinned:
// a rename or a silent drop should fail here rather than surface as an empty
// storefront page. Prices are placeholders on purpose — see MOQ_PRODUCTS.
import { describe, it, expect } from 'vitest';
import { MOQ_PRODUCTS } from './catalog';

describe('MOQ_PRODUCTS seed', () => {
  it('lists exactly the three products the client asked for', () => {
    expect(MOQ_PRODUCTS.map((m) => m.name)).toEqual([
      'FUAN GTT1500',
      'TR30 + CGL5 Blends',
      'TR20 + RT20 Blends',
    ]);
  });

  it('gives every product a stable sort order so the shelf is deterministic', () => {
    const orders = MOQ_PRODUCTS.map((m) => m.sortOrder);
    expect(new Set(orders).size).toBe(MOQ_PRODUCTS.length);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('marks both blends as salt/liquid — they arrive after the white powders', () => {
    const blends = MOQ_PRODUCTS.filter((m) => m.name.includes('Blends'));
    expect(blends).toHaveLength(2);
    for (const b of blends) expect(b.arrival).toBe('salt_liquid');
  });

  it('describes every product, so no card ships with an empty body', () => {
    for (const m of MOQ_PRODUCTS) expect(m.description.length).toBeGreaterThan(10);
  });
});
