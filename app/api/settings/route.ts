import { ok, handler } from '@/lib/api-response';
import { getPackingFees } from '@/lib/settings';

// Public: the storefront cart needs the packing-fee defaults to show the
// on-hand (solo) and pasabay (group-buy) fee before checkout.
export const GET = handler(async () => {
  return ok({ packingFees: await getPackingFees() });
});
