import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys } from '@/lib/db';
import { groupBuySchema } from '@/lib/admin-schemas';
import { isKahatiFull } from '@/lib/kahati';

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = groupBuySchema.partial().parse(await req.json());
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'pricePerKitPhp' || k === 'repackFeePhp') patch[k] = String(v);
    else if (k === 'closesAt') patch[k] = v ? new Date(v as string) : null;
    else patch[k] = v;
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'No fields to update.');
  const db = await getDb();
  const [row] = await db.update(groupBuys).set(patch).where(eq(groupBuys.id, id)).returning();
  if (!row) throw new ApiError(404, 'Group buy not found.');

  // An edit that fills the kit closes the hatian, exactly as reaching the cap at
  // checkout does — otherwise the board keeps offering a full counter to join.
  // Skipped when the admin set the status in this same request; that is explicit intent.
  if (b.status === undefined && row.status === 'open' && isKahatiFull(row.claimedSlots, row.totalSlots)) {
    const [closed] = await db.update(groupBuys).set({ status: 'closed' })
      .where(eq(groupBuys.id, id)).returning();
    return ok(closed);
  }
  return ok(row);
});

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();
  await db.delete(groupBuys).where(eq(groupBuys.id, id));
  return ok({ deleted: true });
});
