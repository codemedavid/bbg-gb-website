import { z } from 'zod';
import { MOQ_BATCH_MAX_KITS } from './pricing';

// A product included in a campaign, with its per-campaign out-of-stock flag.
export const includedProductSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1).max(200),
  outOfStock: z.boolean().optional(),
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
