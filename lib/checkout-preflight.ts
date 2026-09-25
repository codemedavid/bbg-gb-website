// Which cart lines the shop can no longer sell, asked BEFORE a checkout stores
// its payment proofs.
//
// The cart lives in the browser, so it outlives the listings in it: every Group
// Buy and Kahati listing was cancelled and re-seeded under new ids on
// 2026-09-10, and carts saved before that still pointed at the old ones. POST
// /api/orders used to store every proof first and refuse on the first dead line
// inside the transaction — a long upload on mobile data, then one line dropped,
// then the same again on the next tap, and no order.
//
// This mirrors the PERMANENT refusals of that route's per-line checks, and only
// those: a listing that is gone, finished, or off its channel. Quantity, stock
// and price stay in the transaction, where they are decided under a lock. The
// transaction still re-checks everything here, so a line that dies between the
// two is refused exactly as before — this is a courtesy that answers early, not
// the rule.
//
// Every message ends in the line's refId, the shape lib/checkout-error.ts
// matches, so a browser still running the previous build can drop the first
// dead line from `error` alone.
import { eq, inArray } from 'drizzle-orm';
import { groupBuys, moqCampaigns, moqProducts, products } from '@/lib/db';
import { channelRefusal, isChannelEnabled } from '@/lib/product-channels';
import { isJoinableKahatiStatus } from '@/lib/pasalo';
import { canCommit } from '@/lib/group-buy';
import { resolveOpenBatch } from '@/lib/moq-batch-server';
import { resolveJoinableKahati } from '@/lib/kahati-server';

type Db = Parameters<typeof resolveOpenBatch>[0];

export type CheckoutLineKind = 'product' | 'moq_product' | 'moq_campaign' | 'group_buy';
export type CheckoutLineRef = { kind: CheckoutLineKind; refId: string };

export type UnavailableLine = {
  refId: string;
  kind: CheckoutLineKind;
  /** The listing's own name, or '' when the row no longer exists. */
  name: string;
  /** The refusal the transaction would have thrown for this line. */
  message: string;
};

type Check = (db: Db, refId: string) => Promise<Omit<UnavailableLine, 'refId' | 'kind'> | null>;

const checkProduct: Check = async (db, refId) => {
  const [p] = await db.select().from(products).where(eq(products.id, refId));
  if (!p || !p.isActive) return { name: p?.name ?? '', message: `Product not available: ${refId}` };
  if (!isChannelEnabled(p, 'on_hand')) {
    return { name: p.name, message: channelRefusal(`${p.name} ${p.spec}`, 'on_hand', refId) };
  }
  return null;
};

const checkMoqProduct: Check = async (db, refId) => {
  const [m] = await db.select().from(moqProducts).where(eq(moqProducts.id, refId));
  if (!m || !m.isActive) return { name: m?.name ?? '', message: `MOQ product not available: ${refId}` };
  return null;
};

const checkCampaign: Check = async (db, refId) => {
  const [c] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, refId));
  if (!c) return { name: '', message: `Campaign not found: ${refId}` };

  // A batch trades while ANY product it carries is still sold; one carrying no
  // product has nothing whose switches could refuse it. Same rule as the route.
  const carried = (c.includedProducts as { productId?: string }[] | null) ?? [];
  const carriedIds = carried.map((p) => p?.productId).filter((id): id is string => !!id);
  if (carriedIds.length > 0) {
    const linked = await db
      .select({ name: products.name, isGroupBuy: products.isGroupBuy, isActive: products.isActive })
      .from(products).where(inArray(products.id, carriedIds));
    if (!linked.some((p) => isChannelEnabled(p, 'group_buy'))) {
      return { name: c.name, message: channelRefusal(linked[0]?.name ?? c.name, 'group_buy', refId) };
    }
  }

  // A filled batch rolls into its series' open successor, so it is not dead.
  const target = await resolveOpenBatch(db, c);
  if (!canCommit(target.status) && target.status !== 'completed') {
    return { name: c.name, message: `Group buy no longer accepting commitments: ${refId}` };
  }
  return null;
};

const checkKahati: Check = async (db, refId) => {
  const [held] = await db.select().from(groupBuys).where(eq(groupBuys.id, refId));
  if (!held) return { name: '', message: `Group buy not found: ${refId}` };
  // A counter that filled and sealed rolls into its product's open successor,
  // so it is not dead. Same rule as the route.
  const g = await resolveJoinableKahati(db, held);
  if (!isJoinableKahatiStatus(g.status)) {
    return { name: g.name, message: `Kahati "${g.name}" is already closed: ${refId}` };
  }
  if (g.productId) {
    const [linked] = await db
      .select({ isKahati: products.isKahati, isActive: products.isActive, name: products.name })
      .from(products).where(eq(products.id, g.productId));
    if (linked && !isChannelEnabled(linked, 'kahati')) {
      return { name: g.name, message: channelRefusal(linked.name, 'kahati', refId) };
    }
  }
  return null;
};

const CHECKS: Record<CheckoutLineKind, Check> = {
  product: checkProduct,
  moq_product: checkMoqProduct,
  moq_campaign: checkCampaign,
  group_buy: checkKahati,
};

/**
 * Every line of this cart the shop can no longer sell, in cart order.
 *
 * Read-only and lock-free. An empty result means "nothing permanently dead",
 * not "this checkout will succeed" — the transaction still decides that.
 */
export async function findUnavailableLines(
  db: Db,
  items: readonly CheckoutLineRef[],
): Promise<UnavailableLine[]> {
  const found: UnavailableLine[] = [];
  const seen = new Set<string>();
  for (const { kind, refId } of items) {
    // A product held both by the piece and by the kit is one listing.
    const dedupe = `${kind}:${refId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const dead = await CHECKS[kind](db, refId);
    if (dead) found.push({ refId, kind, ...dead });
  }
  return found;
}
