import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqCampaigns } from '@/lib/db';
import { moqCampaignPatchSchema } from '@/lib/moq-schemas';
import { describeBatch } from '@/lib/group-buy';
import { requireBoardsOpenOrAdmin } from '@/lib/schedule-gate';
import { assertCampaignProductsAreGroupBuy } from '@/lib/channel-guard';

type Ctx = { params: Promise<{ id: string }> };

// Public: single campaign with derived fields.
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  // Gated like the campaign list, and for the same two reasons: a shareable
  // URL must not outlive the window, and the admin edit screen reads this
  // endpoint, so admins read through.
  await requireBoardsOpenOrAdmin();
  const { id } = await ctx.params;
  const db = await getDb();
  const [c] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
  if (!c) throw new ApiError(404, 'Campaign not found.');
  return ok(describeBatch(c));
});

// Admin: edit campaign fields (mid-campaign price/MOQ edits apply to new joins).
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  // status is lifecycle-owned: it may only change via /action (approve/extend/cancel),
  // which enforces applyCampaignAction. Strip it here so a PATCH can't bypass the state machine.
  const { status: _status, ...b } = moqCampaignPatchSchema.parse(await req.json());
  // Editing the product list is subject to the same channel rule as creating
  // one — otherwise an off-channel product is one PATCH away from the board.
  if (b.includedProducts) await assertCampaignProductsAreGroupBuy(b.includedProducts);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'pricePerKitPhp' || k === 'shippingPhp') patch[k] = String(v);
    else if (k === 'deadline' || k === 'opensAt') patch[k] = v ? new Date(v as string) : null;
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
