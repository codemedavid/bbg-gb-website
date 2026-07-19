import { z } from 'zod';
import { KAHATI_MAX_VIALS } from './pricing';

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

// A hatian fills exactly one kit, so its vial cap and per-person minimum can
// never exceed KAHATI_MAX_VIALS (10). Enforced here so the rule holds for every
// caller, not just the admin form.
export const groupBuySchema = z.object({
  name: z.string().min(2).max(160),
  pricePerKitPhp: z.number().nonnegative(),
  totalSlots: z.number().int().positive()
    .max(KAHATI_MAX_VIALS, `A hatian fills one kit — the vial cap cannot exceed ${KAHATI_MAX_VIALS}.`)
    .optional(),
  claimedSlots: z.number().int().nonnegative().optional(),
  minVials: z.number().int().positive()
    .max(KAHATI_MAX_VIALS, `A person cannot commit more than ${KAHATI_MAX_VIALS} vials — that is the whole kit.`)
    .optional(),
  repackFeePhp: z.number().nonnegative().optional(),
  status: z.enum(['open', 'closed', 'shipped', 'completed', 'cancelled']).optional(),
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
