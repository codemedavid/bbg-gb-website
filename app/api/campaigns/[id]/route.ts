import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqCampaigns } from '@/lib/db';
import { moqCampaignSchema } from '@/lib/moq-schemas';
import { groupBuyMoqStatus } from '@/lib/pricing';
import { campaignOutcome } from '@/lib/group-buy';

type Ctx = { params: Promise<{ id: string }> };

// Public: single campaign with derived fields.
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const [c] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
  if (!c) throw new ApiError(404, 'Campaign not found.');
  const status = groupBuyMoqStatus(c.committed, c.moq);
  return ok({
    ...c,
    progress: status.progress,
    remaining: status.remaining,
    reached: status.reached,
    outcome: campaignOutcome(c.status, c.committed, c.moq),
  });
});

// Admin: edit campaign fields (mid-campaign price/MOQ edits apply to new joins).
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  // status is lifecycle-owned: it may only change via /action (approve/extend/cancel),
  // which enforces applyCampaignAction. Strip it here so a PATCH can't bypass the state machine.
  const { status: _status, ...b } = moqCampaignSchema.partial().parse(await req.json());
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'pricePerKitPhp' || k === 'shippingPhp') patch[k] = String(v);
    else if (k === 'deadline') patch[k] = v ? new Date(v as string) : null;
    else patch[k] = v;
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'No fields to update.');
  const db = await getDb();
  const [row] = await db.update(moqCampaigns).set(patch).where(eq(moqCampaigns.id, id)).returning();
  if (!row) throw new ApiError(404, 'Campaign not found.');
  return ok(row);
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();
  await db.delete(moqCampaigns).where(eq(moqCampaigns.id, id));
  return ok({ deleted: true });
});
