import { ok, handler } from '@/lib/api-response';
import { getKahatiDownpayment, getMoqPageEnabled, getPackingFees } from '@/lib/settings';

// Public: the storefront cart needs the packing-fee defaults to show the
// on-hand (solo) and pasabay (group-buy) fee before checkout, and the kahati
// downpayment to show what is due now on hatian orders.
export const GET = handler(async () => {
  return ok({
    packingFees: await getPackingFees(),
    kahatiDownpayment: await getKahatiDownpayment(),
    // Drives the MOQ nav tab: the storefront must not advertise a hidden page.
    moqPageEnabled: await getMoqPageEnabled(),
  });
});
