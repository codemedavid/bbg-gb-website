import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { moqProductStatus } from '@/lib/moq-product-cycle';

export type MoqProductRow = {
  id: string;
  name: string;
  spec: string;
  description: string | null;
  imageKey: string | null;
  imageEmoji: string | null;
  pricePhp: string;
  priceUsd: string | null;
  moq: number;
  committed: number;
  cycleNo: number;
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
    cycleNo: p.cycleNo,
    minOrderQty: p.minOrderQty,
    packingFeePhp: p.packingFeePhp,
    arrivalGroup: p.arrivalGroup,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    // Progress towards the target, derived in one place so the storefront card,
    // the admin shelf and the API can never disagree about how full a buy is.
    // Availability is not part of it: a listed item is always buyable — the
    // whole point is that a short target is a reason to order, not a blocker.
    ...moqProductStatus(p.committed, p.moq),
  };
}
