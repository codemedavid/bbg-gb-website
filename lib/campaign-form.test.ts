// The Group Buy campaign form's draft shape, validation and payload.
//
// Extracted from the screen for the same reason lib/moq-product-form.ts was: a
// payload restated inside a test proves the test, not the product. A PATCH that
// silently drops a field does not error — it just fails to save — so the page
// and the assertions have to build the body from one place.
import { describe, it, expect } from 'vitest';
import { MOQ_BATCH_MAX_KITS } from '@/lib/pricing';
import type { MoqCampaign } from '@/lib/types';
import {
  emptyCampaignDraft, campaignDraftFrom, campaignPayloadFrom, validateCampaignDraft,
  type CampaignDraft,
} from './campaign-form';

const campaign = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'c1', name: 'Retatrutide 30mg', pricePerKitPhp: '5200.00', moq: 10, committed: 4,
  perCustomerMin: 1, shippingPhp: '300.00', status: 'open',
  deadline: '2026-08-30T16:00:00.000Z', includedProducts: [{ productId: 'p1', name: 'Reta 30mg' }],
  arrivalGroup: 'white_powder', description: 'Batch one.', createdAt: '2026-07-01T00:00:00.000Z',
  seriesId: 'c1', batchNo: 1, capacity: 10, progress: 0.4, remaining: 6,
  reached: false, full: false, outcome: 'awaiting_moq',
  ...o,
});

const validDraft = (o: Partial<CampaignDraft> = {}): CampaignDraft => ({
  ...emptyCampaignDraft, name: 'Retatrutide 30mg', pricePerKitPhp: '5200', ...o,
});

describe('emptyCampaignDraft', () => {
  it('starts blank so a create form never inherits another campaign', () => {
    expect(emptyCampaignDraft.name).toBe('');
    expect(emptyCampaignDraft.id).toBeUndefined();
    expect(emptyCampaignDraft.includedProducts).toEqual([]);
  });

  it('defaults the batch to the maximum a batch can hold', () => {
    expect(emptyCampaignDraft.moq).toBe(String(MOQ_BATCH_MAX_KITS));
  });
});

describe('campaignDraftFrom', () => {
  it('prefills every editable field from an existing campaign', () => {
    const d = campaignDraftFrom(campaign());
    expect(d).toMatchObject({
      id: 'c1', name: 'Retatrutide 30mg', pricePerKitPhp: '5200.00',
      shippingPhp: '300.00', moq: '10', deadline: '2026-08-30T16:00:00.000Z',
      arrivalGroup: 'white_powder', description: 'Batch one.',
    });
    expect(d.includedProducts).toEqual([{ productId: 'p1', name: 'Reta 30mg' }]);
  });

  it('reads a null description as an empty field rather than the string "null"', () => {
    expect(campaignDraftFrom(campaign({ description: null })).description).toBe('');
  });

  it('copies the included products instead of aliasing the campaign row', () => {
    const c = campaign();
    const d = campaignDraftFrom(c);
    d.includedProducts.push({ productId: 'p2', name: 'Another' });
    expect(c.includedProducts).toHaveLength(1);
  });
});

describe('validateCampaignDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateCampaignDraft(validDraft())).toBeNull();
  });

  it('rejects a name shorter than two characters', () => {
    expect(validateCampaignDraft(validDraft({ name: 'R' }))).toMatch(/name/i);
  });

  // Number('') is 0, which would quietly write a ₱0 kit or trip the API's
  // positive() guard with a 400 the admin never asked for.
  it('rejects an empty price rather than saving a ₱0 kit', () => {
    expect(validateCampaignDraft(validDraft({ pricePerKitPhp: '' }))).toMatch(/price/i);
  });

  it('rejects a zero or negative price', () => {
    expect(validateCampaignDraft(validDraft({ pricePerKitPhp: '0' }))).toMatch(/price/i);
    expect(validateCampaignDraft(validDraft({ pricePerKitPhp: '-1' }))).toMatch(/price/i);
  });

  it('rejects a fractional or zero batch size', () => {
    expect(validateCampaignDraft(validDraft({ moq: '2.5' }))).toMatch(/whole number/i);
    expect(validateCampaignDraft(validDraft({ moq: '0' }))).toMatch(/whole number/i);
  });

  it('rejects a batch larger than the cap, naming the cap', () => {
    const msg = validateCampaignDraft(validDraft({ moq: String(MOQ_BATCH_MAX_KITS + 1) }));
    expect(msg).toContain(String(MOQ_BATCH_MAX_KITS));
  });

  it('rejects a negative packing fee but allows a free one', () => {
    expect(validateCampaignDraft(validDraft({ shippingPhp: '-1' }))).toMatch(/negative/i);
    expect(validateCampaignDraft(validDraft({ shippingPhp: '0' }))).toBeNull();
  });
});

describe('campaignPayloadFrom', () => {
  it('sends numbers for the numeric columns and a trimmed name', () => {
    const p = campaignPayloadFrom(validDraft({ name: '  Retatrutide 30mg  ', shippingPhp: '300', moq: '8' }));
    expect(p).toMatchObject({ name: 'Retatrutide 30mg', pricePerKitPhp: 5200, shippingPhp: 300, moq: 8 });
  });

  it('omits the id on a create so the page posts instead of patching', () => {
    expect(campaignPayloadFrom(validDraft()).id).toBeUndefined();
  });

  it('carries the id on an edit', () => {
    expect(campaignPayloadFrom(validDraft({ id: 'c1' })).id).toBe('c1');
  });

  // The column is nullable; sending "" would store an empty description rather
  // than none, and the storefront prints whatever is there.
  it('sends a blank description as null', () => {
    expect(campaignPayloadFrom(validDraft({ description: '' })).description).toBeNull();
  });

  it('sends a blank deadline as null', () => {
    expect(campaignPayloadFrom(validDraft({ deadline: null })).deadline).toBeNull();
  });

  it('carries the included products through unchanged', () => {
    const included = [{ productId: 'p1', name: 'Reta 30mg', outOfStock: true }];
    expect(campaignPayloadFrom(validDraft({ includedProducts: included })).includedProducts).toEqual(included);
  });

  // status is lifecycle-owned — PATCH /campaigns/:id strips it, and sending it
  // here would suggest the form can approve or cancel a campaign. It cannot.
  it('never sends a status', () => {
    expect(campaignPayloadFrom(validDraft())).not.toHaveProperty('status');
  });
});
