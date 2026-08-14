// Server-side channel guards — the rule in lib/product-channels.ts, applied to
// rows read from the database.
//
// Kept apart from the pure rule so that module stays importable from client
// components (the admin product form renders the same three switches) without
// dragging the database in behind it.

import { inArray } from 'drizzle-orm';
import { getDb, products } from '@/lib/db';
import { ApiError } from '@/lib/session';
import { isChannelEnabled, CHANNEL_LABELS } from '@/lib/product-channels';

/** The shape a campaign's `included_products` entries carry. */
type IncludedProductRef = { productId: string; name?: string };

/**
 * Refuse a campaign that includes a product the admin has not enabled for
 * Group Buy.
 *
 * §5 of the requirement: "only products with Group Buy = ON should be available
 * for selection". The picker filters, but filtering a dropdown is not a rule —
 * a stale form, a replayed request or curl all reach this route with whatever
 * ids they like, and this is the write that would publish them to customers.
 *
 * Refuses the WHOLE campaign rather than dropping the offending lines: partial
 * acceptance would silently publish a campaign different from the one the admin
 * submitted, and they would have no way to tell from the response.
 *
 * A campaign including no products is fine — a free-text batch an admin
 * composed by hand has nothing to check.
 */
export async function assertCampaignProductsAreGroupBuy(
  included: readonly IncludedProductRef[],
): Promise<void> {
  const ids = [...new Set(included.map((p) => p.productId).filter(Boolean))];
  if (ids.length === 0) return;

  const db = await getDb();
  const rows = await db
    .select({
      id: products.id, name: products.name,
      isGroupBuy: products.isGroupBuy, isActive: products.isActive,
    })
    .from(products)
    .where(inArray(products.id, ids));

  const refused = rows.filter((r) => !isChannelEnabled(r, 'group_buy'));
  if (refused.length === 0) return;

  // Named, not counted. The admin has to know WHICH product to un-tick, and a
  // campaign can carry a dozen.
  const names = refused.map((r) => r.name).join(', ');
  throw new ApiError(
    400,
    `Not enabled for ${CHANNEL_LABELS.group_buy}: ${names}. Switch the channel on in Product Management, or remove the product from this campaign.`,
  );
}
