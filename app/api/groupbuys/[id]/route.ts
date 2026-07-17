import { eq } from 'drizzle-orm';
import { getDb, groupBuys } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';
import { perVialPrice } from '@/lib/pricing';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const [g] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  if (!g) throw new ApiError(404, 'Group buy not found.');
  return ok({ ...g, perVialPhp: perVialPrice(Number(g.pricePerKitPhp)), remaining: g.totalSlots - g.claimedSlots, progress: Math.round((g.claimedSlots / g.totalSlots) * 100) });
});
