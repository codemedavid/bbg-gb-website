import { z } from 'zod';

// A product included in a campaign, with its per-campaign out-of-stock flag.
export const includedProductSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1).max(200),
  outOfStock: z.boolean().optional(),
});

export const moqCampaignSchema = z.object({
  name: z.string().min(2).max(160),
  pricePerKitPhp: z.number().nonnegative(),
  moq: z.number().int().positive(),
  perCustomerMin: z.number().int().positive().optional(),
  shippingPhp: z.number().nonnegative().optional(),
  status: z.enum(['open', 'approved', 'cancelled']).optional(),
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
