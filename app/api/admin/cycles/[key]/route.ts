import { asc, eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys, moqCampaigns, orders } from '@/lib/db';
import { getLatestCycleKey } from '@/lib/settings';
import { cycleLabel } from '@/lib/cycle-archive';
import { describeBatch } from '@/lib/group-buy';
import { selectAdminOrders } from '@/lib/admin-orders-server';

// Admin: one cycle from the archive — its hatian counters, its group buy
// batches and its orders, exactly as they stood. Nothing here is a copy: these
// are the live rows, read by the cycle they were stamped with, so a refund or
// a status change made on the orders screen shows here too.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ key: string }> }) => {
  await requireAdmin();
  const cycleKey = decodeURIComponent((await ctx.params).key);
  if (Number.isNaN(Date.parse(cycleKey))) throw new ApiError(400, 'Not a cycle.');
  const db = await getDb();
  const [kahatis, campaigns, orderRows, current] = await Promise.all([
    db.select().from(groupBuys).where(eq(groupBuys.cycleKey, cycleKey)).orderBy(asc(groupBuys.name)),
    db.select().from(moqCampaigns).where(eq(moqCampaigns.cycleKey, cycleKey)).orderBy(asc(moqCampaigns.name), asc(moqCampaigns.batchNo)),
    selectAdminOrders(db, [eq(orders.cycleKey, cycleKey)]),
    getLatestCycleKey(),
  ]);
  if (!kahatis.length && !campaigns.length && !orderRows.length) throw new ApiError(404, 'No such cycle.');
  return ok({
    cycleKey,
    label: cycleLabel(cycleKey),
    current: cycleKey === current,
    kahatis,
    campaigns: campaigns.map(describeBatch),
    orders: orderRows,
  });
});
