import { desc, eq } from 'drizzle-orm';
import { getDb, groupBuys } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { perVialPrice } from '@/lib/pricing';
import { sweepExpiredKahatis } from '@/lib/kahati-server';

export const GET = handler(async () => {
  const db = await getDb();
  // Resolve any counters whose deadline elapsed (cancel unfilled, close full)
  // before reading, then surface only the counters still open to join.
  await sweepExpiredKahatis(db);
  const rows = await db.select().from(groupBuys)
    .where(eq(groupBuys.status, 'open')).orderBy(desc(groupBuys.createdAt));
  return ok(rows.map((g) => ({
    ...g,
    perVialPhp: perVialPrice(Number(g.pricePerKitPhp)),
    remaining: g.totalSlots - g.claimedSlots,
    progress: Math.round((g.claimedSlots / g.totalSlots) * 100),
  })));
});
