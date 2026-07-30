import { describe, it, expect } from 'vitest';
import { productSchema } from './admin-schemas';
import { KAHATI_MAX_VIALS } from './pricing';

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

// The five settings the client asked to live on the PRODUCT, so an admin sets a
// peptide's group buy terms once instead of retyping them into every hatian and
// every campaign. lib/pricing.ts already knows how to seed a listing from them
// (groupBuyUnitPrice, kahatiDefaultsFor, campaignDefaultsFor); this schema is
// the boundary that decides what may ever be written into those columns.
//
// Field names match lib/db/schema.ts and GroupBuyConfig exactly. One vocabulary
// end to end is what stops the seeding rules reading a column nobody fills.
describe('productSchema — group buy configuration', () => {
  const base = { name: 'Retatrutide', pricePhp: 3200 };

  it('accepts the whole group buy section', () => {
    const parsed = productSchema.parse({
      ...base,
      isGroupBuy: true,
      gbPricePerKitPhp: 4500,
      gbPricePerPiecePhp: 480,
      gbVialsPerKit: 10,
      gbMinVials: 2,
      gbMaxVialsPerBatch: 10,
    });

    expect(parsed.gbPricePerKitPhp).toBe(4500);
    expect(parsed.gbPricePerPiecePhp).toBe(480);
    expect(parsed.gbVialsPerKit).toBe(10);
    expect(parsed.gbMinVials).toBe(2);
    expect(parsed.gbMaxVialsPerBatch).toBe(10);
    expect(parsed.isGroupBuy).toBe(true);
  });

  it('leaves a product with no group buy terms alone', () => {
    const parsed = productSchema.parse(base);

    // Absent, not zero: pricing.ts reads "unset" as "fall back to the global
    // default", and a 0 seeded here would read as a free kit instead.
    expect(parsed.gbPricePerKitPhp).toBeUndefined();
    expect(parsed.gbMaxVialsPerBatch).toBeUndefined();
  });

  it('accepts null for a setting the admin cleared', () => {
    // The form sends null to blank a column. Rejecting it would leave an admin
    // unable to undo a price they typed by mistake.
    const parsed = productSchema.parse({
      ...base, gbPricePerKitPhp: null, gbVialsPerKit: null, gbMinVials: null,
    });

    expect(parsed.gbPricePerKitPhp).toBeNull();
    expect(parsed.gbVialsPerKit).toBeNull();
  });

  it('rejects a negative group buy price', () => {
    expect(() => productSchema.parse({ ...base, gbPricePerKitPhp: -1 })).toThrow();
    expect(() => productSchema.parse({ ...base, gbPricePerPiecePhp: -1 })).toThrow();
  });

  it('rejects a kit that holds no vials', () => {
    // groupBuyVialsPerKit divides the kit price by this figure. Zero would be a
    // division by zero reaching a price the customer is charged.
    expect(() => productSchema.parse({ ...base, gbVialsPerKit: 0 })).toThrow();
    expect(() => productSchema.parse({ ...base, gbVialsPerKit: 2.5 })).toThrow();
  });

  it('rejects a minimum or a batch cap below one vial', () => {
    expect(() => productSchema.parse({ ...base, gbMinVials: 0 })).toThrow();
    expect(() => productSchema.parse({ ...base, gbMaxVialsPerBatch: 0 })).toThrow();
    expect(() => productSchema.parse({ ...base, gbMinVials: 1.5 })).toThrow();
  });

  it('allows a batch cap larger than one hatian holds', () => {
    // A hatian fills exactly one kit, but a CAMPAIGN batch holds ten of them —
    // 100 vials of the same product. Capping the product at KAHATI_MAX_VIALS
    // here would make every campaign inherit a hatian's ceiling.
    // kahatiDefaultsFor clamps to KAHATI_MAX_VIALS when it seeds a hatian; the
    // product is free to state the larger figure.
    const parsed = productSchema.parse({ ...base, gbMaxVialsPerBatch: KAHATI_MAX_VIALS * 10 });

    expect(parsed.gbMaxVialsPerBatch).toBe(100);
  });

  it('lets a PATCH touch one group buy setting on its own', () => {
    // The edit form sends only what changed; a partial parse must not demand
    // the whole section back.
    const parsed = productSchema.partial().parse({ gbPricePerKitPhp: 5200 });

    expect(parsed.gbPricePerKitPhp).toBe(5200);
    expect(parsed.name).toBeUndefined();
  });
});
