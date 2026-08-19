import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqCampaigns } from '@/lib/db';
import { campaignActionSchema } from '@/lib/moq-schemas';
import { applyCampaignAction } from '@/lib/group-buy';
import { rollBatch } from '@/lib/moq-batch-server';

type Ctx = { params: Promise<{ id: string }> };

// Admin: run a lifecycle action (approve / extend / cancel) on a campaign.
export const POST = handler(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const { action, deadline } = campaignActionSchema.parse(await req.json());

  const db = await getDb();
  const [c] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
  if (!c) throw new ApiError(404, 'Campaign not found.');

  const result = applyCampaignAction(c.status, action);
  if (!result.ok) throw new ApiError(400, result.message);

  // Rolling is two writes, not a status patch: the batch is sealed and its
  // successor opened inside the same series. Answer with the successor — it is
  // the batch that is live now, and the one the admin's next decision is about.
  if (action === 'roll') {
    const rolled = await rollBatch(db, c);
    if (!rolled) throw new ApiError(409, 'That batch is no longer running — reload the board.');
    return ok(rolled.opened);
  }

  const patch: Record<string, unknown> = { status: result.status };
  if (action === 'extend' && deadline) patch.deadline = new Date(deadline);

  const [row] = await db.update(moqCampaigns).set(patch).where(eq(moqCampaigns.id, id)).returning();
  return ok(row);
});
