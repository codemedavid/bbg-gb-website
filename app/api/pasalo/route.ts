import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { getDb, groupBuys, products } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { perVialPrice } from '@/lib/pricing';
import { counterQuantities } from '@/lib/kahati-quantity';
import { requireBoardsOpen } from '@/lib/schedule-gate';

// The public Pasalo (Bunuan) board.
//
// Its own endpoint rather than a flag on /api/groupbuys, because the two boards
// answer different questions. The Kahati board asks "what is filling"; this one
// asks "what is about to be refunded unless somebody helps" — and the counters
// on it are ranked by urgency rather than by demand.
//
// Deliberately does NOT sweep or reconcile. /api/groupbuys opens counters for
// unlisted products on every read; doing that here would open a fresh Kahati
// counter beside a Pasalo one and split the very demand this board exists to
// concentrate. Both stages are bounded by explicit admin actions.
export const GET = handler(async () => {
  // Same shared window as the Kahati board: a closed storefront is closed.
  await requireBoardsOpen();
  const db = await getDb();

  const rows = await db.select({ gb: groupBuys }).from(groupBuys)
    .leftJoin(products, eq(products.id, groupBuys.productId))
    .where(and(
      eq(groupBuys.status, 'pasalo'),
      // A product whose Kahati switch was turned off is off both boards, the
      // same retroactive rule /api/groupbuys applies. Free-text counters with
      // no product link stay: they have no switch that could refuse them.
      or(isNull(groupBuys.productId), eq(products.isKahati, true)),
    ))
    .orderBy(asc(groupBuys.createdAt))
    .then((r) => r.map((row) => row.gb));

  const board = rows.map((g) => {
    const q = counterQuantities(g);
    return {
      ...g,
      claimedSlots: q.combinedVials,
      perVialPhp: perVialPrice(Number(g.pricePerKitPhp)),
      remaining: q.slotsRemaining,
      progress: q.maxVials > 0 ? Math.round((q.combinedVials / q.maxVials) * 100) : 0,
      kahatiVials: q.kahatiVials,
      pasaloVials: q.pasaloVials,
      minViableVials: q.minRequired,
      neededToQualify: q.neededToQualify,
      slotsRemaining: q.slotsRemaining,
    };
  });

  // Closest to rescue first. The Kahati board ranks by vials committed, which
  // is a popularity order; here the useful order is "whose batch can still be
  // saved with the least help", so a counter needing one vial leads one needing
  // six. Already-qualified counters sort last — they are topping up, not being
  // rescued, and putting them above a batch that is two vials from failing
  // wastes the attention this board exists to direct.
  const ranked = [...board].sort((a, b) => {
    const rescueA = a.neededToQualify > 0 ? 0 : 1;
    const rescueB = b.neededToQualify > 0 ? 0 : 1;
    return rescueA - rescueB
      || a.neededToQualify - b.neededToQualify
      || b.claimedSlots - a.claimedSlots;
  });

  const response = ok(ranked);
  // Anonymous and identical for every visitor, like the Kahati board.
  response.headers.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=45');
  return response;
});
