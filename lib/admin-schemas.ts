import { z } from 'zod';

export const productSchema = z.object({
  code: z.string().max(40).optional(),
  name: z.string().min(2).max(160),
  spec: z.string().min(1).max(120),
  categoryId: z.string().uuid().nullable().optional(),
  pricePhp: z.number().nonnegative(),
  priceUsd: z.number().nonnegative().nullable().optional(),
  isOnHand: z.boolean().optional(),
  onHandKitPhp: z.number().nonnegative().nullable().optional(),
  onHandPiecePhp: z.number().nonnegative().nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
  arrivalGroup: z.enum(['white_powder', 'salt_liquid']).optional(),
  description: z.string().max(2000).nullable().optional(),
  imageEmoji: z.string().max(8).optional(),
  isActive: z.boolean().optional(),
});

export const groupBuySchema = z.object({
  name: z.string().min(2).max(160),
  pricePerKitPhp: z.number().nonnegative(),
  totalSlots: z.number().int().positive(),
  claimedSlots: z.number().int().nonnegative().optional(),
  minVials: z.number().int().positive().optional(),
  repackFeePhp: z.number().nonnegative().optional(),
  status: z.enum(['open', 'closed', 'shipped', 'completed']).optional(),
  closesAt: z.string().datetime().nullable().optional(),
  arrivalGroup: z.enum(['white_powder', 'salt_liquid']).optional(),
  description: z.string().max(2000).nullable().optional(),
});

// Text fields of a payment method. The QR image arrives as a separate multipart
// File part, validated by lib/uploads, so it is not part of this schema.
export const paymentMethodSchema = z.object({
  label: z.string().min(2).max(40),
  accountName: z.string().min(2).max(120),
  accountNumber: z.string().min(2).max(60),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const numToStr = (n: number | null | undefined) => (n == null ? null : String(n));
