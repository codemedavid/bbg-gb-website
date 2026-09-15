import { ok, handler } from '@/lib/api-response';
import { getCurrentCycle, getKahatiDownpaymentPolicy, getMoqPageEnabled, getPackingFees } from '@/lib/settings';
import { cycleKeyOf } from '@/lib/schedule-recurrence';

// Public: the storefront cart needs the packing-fee defaults to show the
// on-hand (solo) and pasabay (group-buy) fee before checkout, and the kahati
// downpayment to show what is due now on hatian orders.
export const GET = handler(async () => {
  const cycle = await getCurrentCycle();
  return ok({
    packingFees: await getPackingFees(),
    // The hatian deposit rule. Public because the CART quotes "due now" before
    // the customer ever reaches checkout, and a cart that quotes the packing fee
    // while checkout asks for a 20% deposit is a cart nobody trusts.
    kahatiDownpayment: await getKahatiDownpaymentPolicy(),
    // Drives the MOQ nav tab: the storefront must not advertise a hidden page.
    moqPageEnabled: await getMoqPageEnabled(),
    // My Orders labels each batch Ongoing or Done, and says when the live one
    // closes. Resolved here, by the resolver checkout stamps orders with, so a
    // batch the page calls ongoing is exactly the one new orders are joining.
    currentCycle: cycle ? { key: cycleKeyOf(cycle), closesAt: cycle.closesAt } : null,
  });
});
