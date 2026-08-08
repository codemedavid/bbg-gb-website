import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { getDb, groupBuys, products } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { perVialPrice } from '@/lib/pricing';
import { sweepKahatis } from '@/lib/kahati-server';
import { kahatiProgressPercent, kahatiClaimedDisplay, sortHatiansByDemand } from '@/lib/kahati';
import { requireBoardsOpen } from '@/lib/schedule-gate';
import { openKahatisForGroupBuyProducts } from '@/lib/kahati-seed-bulk';

export const GET = handler(async () => {
  // Hatian and Group Buy run on one shared window. Checked before the sweep
  // below, so a request to a closed board reads nothing and writes nothing.
  await requireBoardsOpen();
  const db = await getDb();
  // Seal counters that filled their kit (opening each one's successor) and
  // resolve any whose deadline elapsed, then surface only the counters still
  // open to join. Without the sweep a hatian that filled and was never revisited
  // would sit on this board at 10/10 — listed, but with no room for anyone.
  await sweepKahatis(db);
  // Then open a counter for any group-buy product that now lacks one, so the
  // hatian board reflects the current product list rather than whenever an
  // operator last ran a script. Idempotent through the product link, and after
  // the sweep so a product whose batch just ended gets its next counter in the
  // same request. Both steps write only once the gate above has let the request
  // through — a closed board neither reads nor reconciles.
  await openKahatisForGroupBuyProducts();
  // Ordered oldest-first so that the demand sort's tie-break — earliest counter
  // leads — still decides when two counters were created in the same instant.
  // A product with the Kahati switch off never reaches this board, including
  // any counter that was already open when the switch was turned off — the
  // change is retroactive. Left-joined rather than filtered in code so the
  // exclusion is done by the QUERY: this endpoint is public and polled, and a
  // post-filter is one refactor away from being dropped.
  //
  // A counter with no product link is a free-text row an admin made by hand. It
  // has no product whose switches could refuse it, so it stays — NULL must not
  // read as off.
  const rows = await db.select({ gb: groupBuys }).from(groupBuys)
    .leftJoin(products, eq(products.id, groupBuys.productId))
    .where(and(
      eq(groupBuys.status, 'open'),
      or(isNull(groupBuys.productId), eq(products.isKahati, true)),
    ))
    .orderBy(asc(groupBuys.createdAt))
    .then((r) => r.map((row) => row.gb));
  const board = rows.map((g) => {
    // A counter can no longer be stored over its cap, but a row written before
    // that constraint must still not be published as "13 / 10 vials".
    const claimedSlots = kahatiClaimedDisplay(g.claimedSlots, g.totalSlots);
    return {
      ...g,
      claimedSlots,
      perVialPhp: perVialPrice(Number(g.pricePerKitPhp)),
      remaining: Math.max(0, g.totalSlots - claimedSlots),
      progress: kahatiProgressPercent(claimedSlots, g.totalSlots),
    };
  });
  // Sorted after the mapping, so the ranking uses the vials the board DISPLAYS.
  // An over-cap legacy row shows 10 and holds 13; ranking it on the stored 13
  // would put it above a genuine 10/10 on strength of vials nobody can see.
  return ok(sortHatiansByDemand(board));
});
