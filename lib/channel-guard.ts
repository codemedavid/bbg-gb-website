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
 * Drop the batches whose products have all left the Group Buy channel.
 *
 * The mirror of `assertCampaignProductsAreGroupBuy` on the READ side. Every
 * write already honours the switch — the bulk seeder only opens batches for
 * flagged products, the create route refuses an unflagged one — but the board
 * published `moq_campaigns` and nothing else, so un-ticking Group Buy removed
 * the product from every FUTURE batch and left the batch already on the board
 * quietly selling it. The Kahati board has applied its own switch on read all
 * along (app/api/groupbuys/route.ts); this is the same rule for the other one,
 * and it is retroactive in the same way.
 *
 * A batch survives while ANY product it carries is still sold. Dropping a
 * mixed batch whole would delist the products still on the channel along with
 * the one that left; a single withdrawn item is what the per-line `outOfStock`
 * flag is for.
 *
 * A batch carrying no product at all is always kept: a hand-composed batch has
 * no product whose switches could refuse it, and an empty link must not read as
 * "off" — the same allowance both counter boards make for a free-text row.
 *
 * An id with no product behind it counts as off. It fails closed, like
 * `isChannelEnabled`: a deleted product is not one we can still supply.
 *
 * Filtered in code rather than in the query because the link is a JSONB array,
 * and this repo runs PGlite in tests against postgres-js in production — a
 * hand-written JSONB predicate is exactly the kind of thing that passes every
 * test and fails in prod. Kept here, beside the write-side guard it mirrors,
 * rather than inline in the route, so it is tested on its own and cannot be
 * quietly dropped in a refactor of the board.
 */
export async function onGroupBuyChannel<T extends { includedProducts: unknown }>(
  campaigns: readonly T[],
): Promise<T[]> {
  const refs = (row: T) =>
    (Array.isArray(row.includedProducts) ? row.includedProducts as IncludedProductRef[] : [])
      .map((p) => p?.productId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const ids = [...new Set(campaigns.flatMap(refs))];
  if (ids.length === 0) return [...campaigns];

  const db = await getDb();
  const rows = await db
    .select({
      id: products.id,
      isGroupBuy: products.isGroupBuy, isActive: products.isActive,
    })
    .from(products)
    .where(inArray(products.id, ids));

  const enabled = new Set(
    rows.filter((r) => isChannelEnabled(r, 'group_buy')).map((r) => r.id),
  );

  return campaigns.filter((row) => {
    const carried = refs(row);
    return carried.length === 0 || carried.some((id) => enabled.has(id));
  });
}

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
