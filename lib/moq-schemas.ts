import { z } from 'zod';
import { MOQ_BATCH_MAX_KITS } from './pricing';

// A product included in a campaign: its per-campaign out-of-stock flag and the
// group buy terms the admin set for it here.
//
// Every term is optional, and an absent one means "this campaign says nothing
// about it" — the product's own saved setting stands. That is why nothing here
// carries a default: writing one would turn silence into a number the admin
// never typed, and the difference matters when the entry is copied into the
// successor batch a fill opens.
//
// minOrderQty and maxBatchKits are recorded per product, but a batch still
// counts kits in aggregate: the orders route enforces the campaign's
// perCustomerMin and batching claims room against its moq. These are the terms
// the admin agreed per product, not a second gate at checkout.
export const includedProductSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1).max(200),
  outOfStock: z.boolean().optional(),
  pricePerKitPhp: z.number().nonnegative().optional(),
  pricePerPiecePhp: z.number().nonnegative().optional(),
  minOrderQty: z.number().int().positive().optional(),
  // Bounded by the same cap as the campaign's own MOQ, so a per-product figure
  // can never describe a batch the batching code refuses to fill.
  maxBatchKits: z.number().int().positive().max(MOQ_BATCH_MAX_KITS).optional(),
  vialsPerKit: z.number().int().positive().optional(),
});

export const moqCampaignSchema = z.object({
  name: z.string().min(2).max(160),
  pricePerKitPhp: z.number().nonnegative(),
  // A batch holds at most MOQ_BATCH_MAX_KITS kits — an admin cannot configure a
  // campaign that would legitimise an 11/10 counter. Bigger runs are expressed
  // as successive batches, which the commit route opens on its own.
  moq: z.number().int().positive().max(MOQ_BATCH_MAX_KITS),
  shippingPhp: z.number().nonnegative().optional(),
  // 'completed' is reached by filling the batch, never by an admin write; it is
  // listed so a round-tripped row validates.
  status: z.enum(['open', 'approved', 'completed', 'cancelled']).optional(),
  deadline: z.string().datetime().nullable().optional(),
  includedProducts: z.array(includedProductSchema).optional(),
  arrivalGroup: z.enum(['white_powder', 'salt_liquid']).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export const campaignActionSchema = z.object({
  action: z.enum(['approve', 'extend', 'cancel']),
  // extend carries a new deadline; approve/cancel ignore it.
  deadline: z.string().datetime().nullable().optional(),
});

export const campaignCommitSchema = z.object({
  qty: z.number().int().positive(),
  shipName: z.string().min(2).max(120),
  shipPhone: z.string().min(7).max(40),
  shipAddress: z.string().min(5).max(500),
});
