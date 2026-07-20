import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';

export type MoqProductRow = {
  id: string;
  name: string;
  spec: string;
  description: string | null;
  imageKey: string | null;
  imageEmoji: string | null;
  pricePhp: string;
  priceUsd: string | null;
  stock: number;
  minOrderQty: number;
  packingFeePhp: string | null;
  arrivalGroup: 'white_powder' | 'salt_liquid';
  isActive: boolean;
  sortOrder: number;
};

// Resolves a stored MOQ product into the client shape, turning the image
// storage key into a served/signed URL (null when nothing has been uploaded —
// the card falls back to the emoji).
export async function serializeMoqProduct(p: MoqProductRow) {
  return {
    id: p.id,
    name: p.name,
    spec: p.spec,
    description: p.description,
    imageUrl: p.imageKey ? await signedUrl(BUCKETS.moq, p.imageKey) : null,
    imageEmoji: p.imageEmoji,
    pricePhp: p.pricePhp,
    priceUsd: p.priceUsd,
    stock: p.stock,
    minOrderQty: p.minOrderQty,
    packingFeePhp: p.packingFeePhp,
    arrivalGroup: p.arrivalGroup,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    // Derived so every surface agrees on what "buyable" means: in stock and
    // holding at least one full minimum order.
    inStock: p.stock > 0 && p.stock >= p.minOrderQty,
  };
}
