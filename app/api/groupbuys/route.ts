import { desc, eq } from 'drizzle-orm';
import { getDb, groupBuys } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { perVialPrice } from '@/lib/pricing';
import { sweepKahatis } from '@/lib/kahati-server';
import { kahatiProgressPercent, kahatiClaimedDisplay } from '@/lib/kahati';

export const GET = handler(async () => {
  const db = await getDb();
  // Seal counters that filled their kit (opening each one's successor) and
  // resolve any whose deadline elapsed, then surface only the counters still
  // open to join. Without the sweep a hatian that filled and was never revisited
  // would sit on this board at 10/10 — listed, but with no room for anyone.
  await sweepKahatis(db);
  const rows = await db.select().from(groupBuys)
    .where(eq(groupBuys.status, 'open')).orderBy(desc(groupBuys.createdAt));
  return ok(rows.map((g) => {
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
  }));
});
