// Mapping a catalog entry to the `products` row the seeder inserts.
//
// Lives here rather than inline in scripts/seed.ts so it can be asserted
// without running a wipe-and-reseed: the seeder deletes every product before it
// writes, which is not something a test suite should be doing to prove a field
// is carried through.
//
// Money is written as strings because the columns are numeric(12,2) — a raw JS
// number reaches the driver as a float and loses scale.
import { CATEGORY_DESC, type SeedProduct } from './catalog';

/** The catalogue-wide default, matching products.kit_size in the schema. */
const DEFAULT_KIT_SIZE = 10;

// The aesthetics shelf — fillers, toxins and prefilled skin boosters. None of
// it is sold per vial, so there is nothing for a hatian to split, and a fresh
// catalogue starts with its Kahati switch off (lib/product-channels.ts).
//
// A seeding default, not a rule: the channel is a per-product switch now, so an
// admin who disagrees about any one row changes it on the form.
const UNSPLITTABLE_CATEGORY_SLUG = 'aesthetics';

const money = (n: number | null | undefined): string | null =>
  n != null ? String(n) : null;

export function seedProductRow(product: SeedProduct, categoryId: string) {
  return {
    code: product.code,
    name: product.name,
    spec: product.spec,
    categoryId,
    pricePhp: String(product.pricePhp),
    priceUsd: money(product.priceUsd),
    isOnHand: !!product.isOnHand,
    onHandKitPhp: money(product.onHandKitPhp),
    onHandPiecePhp: money(product.onHandPiecePhp),
    stock: product.stock ?? 0,
    // The divisor behind the weekly report's Kits column. A series packed
    // otherwise than ten-to-a-kit has to say so, or the batch order is placed
    // at the wrong multiple.
    kitSize: product.kitSize ?? DEFAULT_KIT_SIZE,
    arrivalGroup: product.arrival,
    // A product may describe itself; the category blurb is the fallback for the
    // majority that have nothing more specific to say.
    description: product.description ?? CATEGORY_DESC[product.cat],
    imageEmoji: product.emoji ?? '💧',
    soldCount: product.soldCount ?? 0,
    // Group buy terms. Null rather than 0 when unstated: null means "this
    // product states no figure of its own" and falls back to the global
    // defaults, where a ₱0 group buy price would read as free.
    isGroupBuy: !!product.isGroupBuy,
    // The Kahati switch. Group-buy products get counters by default, except the
    // aesthetics ones: a single prefilled syringe has no vials to split among
    // ten people. Derived from the category rather than declared per entry,
    // mirroring the backfill in drizzle/0019_product_sales_channels.sql — a
    // fresh seed and a migrated database must agree on what a hatian may be
    // opened for, or a local environment quietly disagrees with production
    // about what is for sale. An admin can still change any of it on the form;
    // this is only where a brand-new catalogue starts.
    isKahati: !!product.isGroupBuy && product.cat !== UNSPLITTABLE_CATEGORY_SLUG,
    gbPricePerKitPhp: money(product.gbPricePerKitPhp),
    gbPricePerPiecePhp: money(product.gbPricePerPiecePhp),
    gbVialsPerKit: product.gbVialsPerKit ?? null,
    gbMinVials: product.gbMinVials ?? null,
    gbMaxVialsPerBatch: product.gbMaxVialsPerBatch ?? null,
  };
}
