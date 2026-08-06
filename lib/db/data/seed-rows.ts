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
  };
}
