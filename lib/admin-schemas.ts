import { z } from 'zod';
import { KAHATI_MAX_VIALS } from './pricing';
import { scheduleWindowErrorFromIso } from './campaign-schedule';

export const productSchema = z.object({
  code: z.string().max(40).optional(),
  name: z.string().min(2).max(160),
  // Optional, matching the MOQ shelf (moqProductSchema): many real items
  // (aesthetics "per piece", botulinum toxins) carry no spec beyond the name,
  // and forcing one rejected an otherwise-valid save. The create route defaults
  // an absent spec to '' so the NOT NULL column stays satisfied.
  spec: z.string().max(120).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  pricePhp: z.number().nonnegative(),
  priceUsd: z.number().nonnegative().nullable().optional(),
  isOnHand: z.boolean().optional(),
  onHandKitPhp: z.number().nonnegative().nullable().optional(),
  onHandPiecePhp: z.number().nonnegative().nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
  // Vials per supplier kit, used by the weekly report's per-product rollup.
  // Positive, because it is a divisor: a 0 would make every kit count Infinity.
  kitSize: z.number().int().positive().optional(),
  arrivalGroup: z.enum(['white_powder', 'salt_liquid']).optional(),
  description: z.string().max(2000).nullable().optional(),
  imageEmoji: z.string().max(8).optional(),
  isActive: z.boolean().optional(),

  // Product-level group buy configuration. These five belong to the product and
  // seed every listing that carries it (lib/pricing.ts). Nullable throughout:
  // null is "this product states no figure of its own", which the seeding rules
  // read as "use the global default" — distinct from 0, which for a price would
  // mean a free kit and for a count would mean a batch nothing fits in.
  isGroupBuy: z.boolean().optional(),
  gbPricePerKitPhp: z.number().nonnegative().nullable().optional(),
  gbPricePerPiecePhp: z.number().nonnegative().nullable().optional(),
  gbVialsPerKit: z.number().int().positive().nullable().optional(),
  gbMinVials: z.number().int().positive().nullable().optional(),
  // Deliberately uncapped. A hatian fills one kit, but a campaign batch holds
  // ten of them, so the product may legitimately state 100 vials; the hatian
  // seeding clamps to KAHATI_MAX_VIALS at the point it matters.
  gbMaxVialsPerBatch: z.number().int().positive().nullable().optional(),
});

// A hatian fills exactly one kit, so its vial cap and per-person minimum can
// never exceed KAHATI_MAX_VIALS (10). Enforced here so the rule holds for every
// caller, not just the admin form.
const groupBuyFields = z.object({
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
  // 'scheduled' is derived from opensAt by the create route rather than picked
  // by hand; it is listed so a round-tripped row validates.
  status: z.enum(['scheduled', 'open', 'closed', 'shipped', 'completed', 'cancelled']).optional(),
  // When the counter goes on the board. Absent or past means now.
  opensAt: z.string().datetime().nullable().optional(),
  closesAt: z.string().datetime().nullable().optional(),
  arrivalGroup: z.enum(['white_powder', 'salt_liquid']).optional(),
  description: z.string().max(2000).nullable().optional(),
});

// Create payload: claimed vials can never exceed the cap — an omitted cap
// defaults to KAHATI_MAX_VIALS, so the bound still holds.
export const groupBuySchema = groupBuyFields
  .refine(
    (b) => (b.claimedSlots ?? 0) <= (b.totalSlots ?? KAHATI_MAX_VIALS),
    { message: 'Claimed vials cannot exceed the vial cap.', path: ['claimedSlots'] },
  )
  // A counter that opens after it closes accepts nothing for its whole life.
  // Unlike the cap check this one survives a partial body — an absent half makes
  // it vacuously true — so the PATCH shape carries it too.
  .refine(
    (b) => scheduleWindowErrorFromIso(b.opensAt, b.closesAt) === null,
    { message: 'The open date must be before the close date.', path: ['opensAt'] },
  );

// PATCH bodies are partial, so the cross-field cap check cannot live here — the
// missing half is only known once merged with the current row. The route
// validates the merged effective values instead.
export const groupBuyPatchSchema = groupBuyFields.partial().refine(
  (b) => scheduleWindowErrorFromIso(b.opensAt, b.closesAt) === null,
  { message: 'The open date must be before the close date.', path: ['opensAt'] },
);

// Text fields of a payment method. The QR image arrives as a separate multipart
// File part, validated by lib/uploads, so it is not part of this schema.
export const paymentMethodSchema = z.object({
  label: z.string().min(2).max(40),
  accountName: z.string().min(2).max(120),
  accountNumber: z.string().min(2).max(60),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

// Text fields of an MOQ product. The image arrives as a separate multipart File
// part, validated by lib/uploads, so it is not part of this schema.
export const moqProductSchema = z.object({
  name: z.string().min(2).max(160),
  spec: z.string().max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  pricePhp: z.number().nonnegative(),
  priceUsd: z.number().nonnegative().nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
  // The "MOQ" the page is named for: a customer must order at least this many.
  minOrderQty: z.number().int().positive().optional(),
  packingFeePhp: z.number().nonnegative().nullable().optional(),
  arrivalGroup: z.enum(['white_powder', 'salt_liquid']).optional(),
  imageEmoji: z.string().max(8).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export type MoqProductInput = z.infer<typeof moqProductSchema>;

// Multipart fields arrive as strings. Absent fields stay absent so a PATCH only
// touches what the admin actually edited; empty strings clear nullable fields.
//
// Overloaded so the create path keeps `name`/`pricePhp` required — a single
// union return type would make every required field look optional to callers.
export function parseMoqProductForm(form: FormData, partial: false): MoqProductInput;
export function parseMoqProductForm(form: FormData, partial: true): Partial<MoqProductInput>;
export function parseMoqProductForm(form: FormData, partial: boolean): MoqProductInput | Partial<MoqProductInput>;
export function parseMoqProductForm(form: FormData, partial: boolean) {
  const str = (k: string) => (form.get(k) == null ? undefined : String(form.get(k)));
  const num = (k: string) => {
    const v = form.get(k);
    return v == null || v === '' ? undefined : Number(v);
  };
  const bool = (k: string) => (form.get(k) == null ? undefined : String(form.get(k)) === 'true');
  const nullableStr = (k: string) => {
    const v = form.get(k);
    if (v == null) return undefined;
    return String(v) === '' ? null : String(v);
  };

  const raw = {
    name: str('name'), spec: str('spec'), description: nullableStr('description'),
    pricePhp: num('pricePhp'), priceUsd: num('priceUsd'), stock: num('stock'),
    minOrderQty: num('minOrderQty'), packingFeePhp: num('packingFeePhp'),
    arrivalGroup: str('arrivalGroup'), imageEmoji: str('imageEmoji'),
    isActive: bool('isActive'), sortOrder: num('sortOrder'),
  };
  const defined = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
  return partial ? moqProductSchema.partial().parse(defined) : moqProductSchema.parse(defined);
}

export const numToStr = (n: number | null | undefined) => (n == null ? null : String(n));
