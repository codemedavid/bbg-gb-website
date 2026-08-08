import { getDb } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { getSession } from '@/lib/session';
import { getCurrentCycle } from '@/lib/settings';
import { cycleKeyOf } from '@/lib/schedule-recurrence';
import { listCyclePayments } from '@/lib/packing-cycle-server';
import { hasPaidPackingFeeThisCycle } from '@/lib/packing-cycle';

// Customer: whether they have already paid to have this cycle's parcel packed,
// and so owe no further packing fee until the next one. Checkout reads this to
// price the cart — answered by the same query the checkout route itself uses,
// so the summary and the charge cannot disagree.
//
// A signed-out visitor is not an error here: the cart is local and both boards
// are public, so they simply have nothing in this cycle yet.
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok({ paidThisCycle: false });
  const cycle = await getCurrentCycle();
  const payments = await listCyclePayments(await getDb(), session.sub, cycle ? cycleKeyOf(cycle) : null);
  return ok({ paidThisCycle: hasPaidPackingFeeThisCycle(payments) });
});
