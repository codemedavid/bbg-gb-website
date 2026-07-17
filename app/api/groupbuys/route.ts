import { desc } from 'drizzle-orm';
import { getDb, groupBuys } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { perVialPrice } from '@/lib/pricing';

export const GET = handler(async () => {
  const db = await getDb();
  const rows = await db.select().from(groupBuys).orderBy(desc(groupBuys.createdAt));
  return ok(rows.map((g) => ({
    ...g,
    perVialPhp: perVialPrice(Number(g.pricePerKitPhp)),
    remaining: g.totalSlots - g.claimedSlots,
    progress: Math.round((g.claimedSlots / g.totalSlots) * 100),
  })));
});
