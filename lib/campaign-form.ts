// The Group Buy campaign form's draft, validation and payload.
//
// Extracted from the screen for the same reason lib/moq-product-form.ts was: the
// page and its tests have to build the body from one place, or a PATCH that
// silently drops a field passes review — it does not error, it just fails to
// save. Keeping it here also lets the routed Create and Edit pages share one
// definition of "a campaign being written" without importing each other.
import { MOQ_BATCH_MAX_KITS } from '@/lib/pricing';
import { scheduleWindowErrorFromIso } from '@/lib/campaign-schedule';
import type { CampaignPayload, IncludedProduct, MoqCampaign } from '@/lib/types';

// Every field is the string the input holds, not the number the column wants.
// Numeric inputs hand back '' when cleared, and Number('') is 0 — coercing on
// the way in would quietly turn a cleared price into a ₱0 kit.
export type CampaignDraft = {
  id?: string;
  name: string;
  pricePerKitPhp: string;
  shippingPhp: string;
  moq: string;
  opensAt: string | null;
  deadline: string | null;
  arrivalGroup: MoqCampaign['arrivalGroup'];
  description: string;
  includedProducts: IncludedProduct[];
};

export const emptyCampaignDraft: CampaignDraft = {
  name: '', pricePerKitPhp: '0', shippingPhp: '300', moq: String(MOQ_BATCH_MAX_KITS),
  opensAt: null, deadline: null, arrivalGroup: 'white_powder', description: '', includedProducts: [],
};

// Prefills the form from an existing campaign. The included products are copied,
// not aliased: the form edits its draft in place on every keystroke and must not
// reach back into the cached campaign row while doing it.
export const campaignDraftFrom = (c: MoqCampaign): CampaignDraft => ({
  id: c.id,
  name: c.name,
  pricePerKitPhp: c.pricePerKitPhp,
  shippingPhp: c.shippingPhp,
  moq: String(c.moq),
  opensAt: c.opensAt,
  deadline: c.deadline,
  arrivalGroup: c.arrivalGroup,
  description: c.description ?? '',
  includedProducts: c.includedProducts.map((p) => ({ ...p })),
});

// Returns the reason the draft cannot be saved, or null. The bounds mirror what
// the API enforces so the admin reads the problem in the form rather than
// receiving a 400 they did not ask for.
export function validateCampaignDraft(d: CampaignDraft): string | null {
  if (d.name.trim().length < 2) return 'Name must be at least 2 characters.';
  if (!(Number(d.pricePerKitPhp) > 0)) return 'Price / kit must be greater than 0.';
  if (!Number.isInteger(Number(d.moq)) || Number(d.moq) < 1) return 'Batch size must be a whole number of 1 or more.';
  if (Number(d.moq) > MOQ_BATCH_MAX_KITS) return `A batch holds at most ${MOQ_BATCH_MAX_KITS} kits — bigger runs continue as batch #2.`;
  if (Number(d.shippingPhp) < 0) return 'Packing fee cannot be negative.';
  // Mirrors the API's refine, so a batch that would open after it closes is
  // caught in the form rather than coming back as a 400 the admin did not ask for.
  return scheduleWindowErrorFromIso(d.opensAt, d.deadline);
}

// Builds the body for POST /campaigns and PATCH /campaigns/:id.
//
// `status` is deliberately absent: it is lifecycle-owned by /campaigns/:id/action
// (approve, extend, cancel), and PATCH strips it. Sending it from here would
// imply this form can approve a campaign. It cannot.
export function campaignPayloadFrom(d: CampaignDraft): CampaignPayload {
  return {
    ...(d.id ? { id: d.id } : {}),
    name: d.name.trim(),
    pricePerKitPhp: Number(d.pricePerKitPhp),
    moq: Number(d.moq),
    shippingPhp: Number(d.shippingPhp),
    opensAt: d.opensAt,
    deadline: d.deadline,
    includedProducts: d.includedProducts,
    arrivalGroup: d.arrivalGroup,
    // The column is nullable; '' would store an empty description rather than
    // none, and the storefront prints whatever is there.
    description: d.description.trim() || null,
  };
}
