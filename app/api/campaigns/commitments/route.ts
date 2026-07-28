import { getDb } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { getSession } from '@/lib/session';
import { listCampaignCommitments } from '@/lib/campaign-commitment-server';
import { seriesWithPaidPackingFee } from '@/lib/campaign-commitment';

// Customer: which group buys they already have a parcel going in, and so owe no
// further packing fee for. Checkout reads this to price the cart — answered by
// the same query the checkout route itself uses, so the summary and the charge
// cannot disagree.
//
// A signed-out visitor is not an error here: the cart is local and the group buy
// board is public, so they simply have no commitments yet.
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok({ paidSeriesIds: [] });
  const commitments = await listCampaignCommitments(await getDb(), session.sub);
  return ok({ paidSeriesIds: [...seriesWithPaidPackingFee(commitments)] });
});
