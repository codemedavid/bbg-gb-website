import { eq } from 'drizzle-orm';
import { getDb, groupBuys } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';
import { perVialPrice } from '@/lib/pricing';
import { kahatiProgressPercent, kahatiClaimedDisplay } from '@/lib/kahati';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const [g] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  if (!g) throw new ApiError(404, 'Group buy not found.');
  // Same clamp as the board: a counter never reads past its cap, `remaining`
  // never goes negative, and progress cannot be NaN on a zero cap.
  const claimedSlots = kahatiClaimedDisplay(g.claimedSlots, g.totalSlots);
  return ok({
    ...g,
    claimedSlots,
    perVialPhp: perVialPrice(Number(g.pricePerKitPhp)),
    remaining: g.totalSlots - claimedSlots,
    progress: kahatiProgressPercent(claimedSlots, g.totalSlots),
  });
});
