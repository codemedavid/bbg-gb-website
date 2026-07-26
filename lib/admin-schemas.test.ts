import { describe, it, expect } from 'vitest';
import { productSchema } from './admin-schemas';

// A catalog product must be addable without a Spec — many real items (aesthetics
// sold "per piece", botulinum toxins) have no meaningful spec beyond the name.
// The sibling MOQ shelf (moqProductSchema) already treats spec as optional; the
// main catalog was inconsistently forcing it, so a blank Spec rejected the save
// with "spec: String must contain at least 1 character(s)".
describe('productSchema — spec is optional', () => {
  it('accepts a product with spec omitted entirely', () => {
    const parsed = productSchema.parse({ name: 'Nabota', pricePhp: 1200 });
    expect(parsed.spec).toBeUndefined();
  });

  it('accepts a product with an empty-string spec', () => {
    const parsed = productSchema.parse({ name: 'Nabota', spec: '', pricePhp: 1200 });
    expect(parsed.spec).toBe('');
  });

  it('still enforces the other required fields (name >= 2 chars)', () => {
    expect(() => productSchema.parse({ name: 'x', pricePhp: 1 })).toThrow();
  });

  it('still enforces a non-negative price', () => {
    expect(() => productSchema.parse({ name: 'Valid Name', pricePhp: -1 })).toThrow();
  });
});
