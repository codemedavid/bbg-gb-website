// Pushing a catalog edit onto the listings that are already on the boards.
//
// A listing seeds its terms from the product once, when it is opened
// (lib/kahati-seed.ts, lib/campaign-seed.ts). Nothing pushed a LATER edit, so
// an admin who corrected a price in product management still saw the old figure
// on both boards until the batch ended. These are the rules that close that gap.
//
// The rule is deliberately "push what this edit CHANGED", not "overwrite the
// listing with the product's terms". An admin may discount a single counter by
// hand; renaming the product must not silently undo that discount. Only the
// fields the product edit actually moved travel.
import { describe, it, expect } from 'vitest';
import { kahatiListingPatch, campaignListingPatch } from './listing-sync';
import type { SeedableProduct } from './campaign-seed';

const product = (o: Partial<SeedableProduct> = {}): SeedableProduct => ({
  id: 'prod-1',
  name: 'Retatrutide',
  spec: '20mg vial',
  pricePhp: '4800',
  gbPricePerKitPhp: null,
  gbPricePerPiecePhp: null,
  gbVialsPerKit: null,
  gbMinVials: null,
  gbMaxVialsPerBatch: null,
  arrivalGroup: 'white_powder',
  ...o,
});

const counter = (o: Partial<Parameters<typeof kahatiListingPatch>[2]> = {}) => ({
  totalSlots: 10, claimedSlots: 0, minVials: 1, ...o,
});

const batch = (o: Partial<Parameters<typeof campaignListingPatch>[2]> = {}) => ({
  moq: 10, committed: 0, perCustomerMin: 1,
  includedProducts: [{ productId: 'prod-1', name: 'Retatrutide', outOfStock: false }],
  ...o,
});

describe('kahatiListingPatch', () => {
  it('pushes a new group buy kit price onto the counter', () => {
    const before = product({ gbPricePerKitPhp: '4800' });
    const after = product({ gbPricePerKitPhp: '4000' });

    expect(kahatiListingPatch(before, after, counter()).pricePerKitPhp).toBe('4000');
  });

  it('reprices from the shop price when the product states no group buy price', () => {
    const before = product({ pricePhp: '4800' });
    const after = product({ pricePhp: '5200' });

    expect(kahatiListingPatch(before, after, counter()).pricePerKitPhp).toBe('5200');
  });

  it('renames the counter when the product name or its spec changes', () => {
    const before = product();
    const after = product({ spec: '30mg vial' });

    expect(kahatiListingPatch(before, after, counter()).name).toBe('Retatrutide 30mg vial');
  });

  it('leaves an admin’s hand-set counter price alone when the edit did not touch pricing', () => {
    const before = product();
    const after = product({ name: 'Retatrutide (Salt Form)' });

    const patch = kahatiListingPatch(before, after, counter());
    expect(patch.name).toBe('Retatrutide (Salt Form) 20mg vial');
    expect(patch).not.toHaveProperty('pricePerKitPhp');
  });

  it('changes nothing when the edit moved no detail the board shows', () => {
    const before = product({ gbPricePerKitPhp: '4000' });
    const after = product({ gbPricePerKitPhp: '4000' });

    expect(kahatiListingPatch(before, after, counter())).toEqual({});
  });

  it('keeps the counter priced when the edit left the product unpriceable', () => {
    const before = product({ pricePhp: '4800' });
    const after = product({ pricePhp: '0' });

    // A free kit on the board is worse than a stale one: the same refusal
    // kahatiSeedFor makes when it declines to open a counter it cannot price.
    expect(kahatiListingPatch(before, after, counter())).not.toHaveProperty('pricePerKitPhp');
  });

  it('never lowers the vial cap below the vials already claimed', () => {
    const before = product({ gbMaxVialsPerBatch: 10 });
    const after = product({ gbMaxVialsPerBatch: 3 });

    // Six people already hold a vial. The database forbids 6/3 outright
    // (group_buys_claimed_within_cap), and delisting their vials would be worse
    // than a cap that shrinks only as far as it can.
    expect(kahatiListingPatch(before, after, counter({ claimedSlots: 6 })).totalSlots).toBe(6);
  });

  it('lowers the cap in full when nobody has claimed a vial yet', () => {
    const before = product({ gbMaxVialsPerBatch: 10 });
    const after = product({ gbMaxVialsPerBatch: 3 });

    expect(kahatiListingPatch(before, after, counter()).totalSlots).toBe(3);
  });

  it('clamps the per-person minimum to the cap the same edit set', () => {
    const before = product({ gbMinVials: 2, gbMaxVialsPerBatch: 10 });
    const after = product({ gbMinVials: 8, gbMaxVialsPerBatch: 4 });

    const patch = kahatiListingPatch(before, after, counter());
    expect(patch.totalSlots).toBe(4);
    // A floor above the cap rejects every commitment, including the first.
    expect(patch.minVials).toBe(4);
  });

  it('pulls a stored minimum down when a shrinking cap strands it above', () => {
    const before = product({ gbMaxVialsPerBatch: 10 });
    const after = product({ gbMaxVialsPerBatch: 3 });

    // The product's own minimum did not move; the counter's hand-set one is now
    // unmeetable, so the cap change has to drag it down with it.
    expect(kahatiListingPatch(before, after, counter({ minVials: 8 })).minVials).toBe(3);
  });

  it('pushes the arrival group so the counter ships with its batch', () => {
    const before = product({ arrivalGroup: 'white_powder' });
    const after = product({ arrivalGroup: 'salt_liquid' });

    expect(kahatiListingPatch(before, after, counter()).arrivalGroup).toBe('salt_liquid');
  });
});

describe('campaignListingPatch', () => {
  it('pushes a new kit price onto the batch', () => {
    const before = product({ gbPricePerKitPhp: '6600' });
    const after = product({ gbPricePerKitPhp: '6000' });

    expect(campaignListingPatch(before, after, batch()).pricePerKitPhp).toBe('6000');
  });

  it('renames the batch, spec and all', () => {
    const before = product();
    const after = product({ name: 'Cagrilintide' });

    expect(campaignListingPatch(before, after, batch()).name).toBe('Cagrilintide 20mg vial');
  });

  it('refreshes the product label the batch carries', () => {
    const before = product();
    const after = product({ name: 'Cagrilintide' });

    expect(campaignListingPatch(before, after, batch()).includedProducts).toEqual([
      { productId: 'prod-1', name: 'Cagrilintide', outOfStock: false },
    ]);
  });

  it('keeps a per-product out-of-stock flag while relabelling it', () => {
    const before = product();
    const after = product({ name: 'Cagrilintide' });
    const row = batch({
      includedProducts: [{ productId: 'prod-1', name: 'Retatrutide', outOfStock: true }],
    });

    expect(campaignListingPatch(before, after, row).includedProducts).toEqual([
      { productId: 'prod-1', name: 'Cagrilintide', outOfStock: true },
    ]);
  });

  it('never lowers the MOQ below the kits already committed', () => {
    const before = product({ gbMaxVialsPerBatch: 100 });
    const after = product({ gbMaxVialsPerBatch: 20 });

    expect(campaignListingPatch(before, after, batch({ committed: 7 })).moq).toBe(7);
  });

  it('clamps the per-customer minimum to the MOQ the same edit set', () => {
    const before = product({ gbMinVials: 10, gbMaxVialsPerBatch: 100 });
    const after = product({ gbMinVials: 90, gbMaxVialsPerBatch: 20 });

    const patch = campaignListingPatch(before, after, batch());
    expect(patch.moq).toBe(2);
    expect(patch.perCustomerMin).toBe(2);
  });

  it('leaves the terms of a batch that carries other products too', () => {
    const before = product();
    const after = product({ name: 'Cagrilintide', gbPricePerKitPhp: '6000' });
    const row = batch({
      includedProducts: [
        { productId: 'prod-1', name: 'Retatrutide', outOfStock: false },
        { productId: 'prod-2', name: 'Tirzepatide', outOfStock: false },
      ],
    });

    const patch = campaignListingPatch(before, after, row);
    // One product of several cannot name or price the batch, but its own label
    // in the list is still its own.
    expect(patch).not.toHaveProperty('name');
    expect(patch).not.toHaveProperty('pricePerKitPhp');
    expect(patch.includedProducts).toEqual([
      { productId: 'prod-1', name: 'Cagrilintide', outOfStock: false },
      { productId: 'prod-2', name: 'Tirzepatide', outOfStock: false },
    ]);
  });

  it('changes nothing when the edit moved no detail the board shows', () => {
    const before = product({ gbPricePerKitPhp: '6000' });
    const after = product({ gbPricePerKitPhp: '6000' });

    expect(campaignListingPatch(before, after, batch())).toEqual({});
  });
});
