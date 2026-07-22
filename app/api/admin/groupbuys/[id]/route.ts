import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys, orderItems } from '@/lib/db';
import { groupBuyPatchSchema } from '@/lib/admin-schemas';
import { isKahatiFull, KAHATI_MIN_VIABLE_VIALS } from '@/lib/kahati';
import { cancelKahati, closeFullKahati, notifyKahatiCancellations } from '@/lib/kahati-server';

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = groupBuyPatchSchema.parse(await req.json());
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'pricePerKitPhp' || k === 'repackFeePhp') patch[k] = String(v);
    else if (k === 'closesAt') patch[k] = v ? new Date(v as string) : null;
    else patch[k] = v;
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'No fields to update.');

  const db = await getDb();
  const [current] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  if (!current) throw new ApiError(404, 'Group buy not found.');

  // Validate the merged effective row, not just the patch: an edit that leaves
  // totalSlots alone can still push claimedSlots past the cap, and vice versa.
  const claimed = b.claimedSlots ?? current.claimedSlots;
  const cap = b.totalSlots ?? current.totalSlots;
  if (claimed > cap) {
    throw new ApiError(400, `Claimed vials (${claimed}) cannot exceed the vial cap (${cap}).`);
  }

  // Closing an open hatian below the 7-vial minimum means the batch is never
  // ordered — by business rule that is a cancellation, so the participants are
  // released and refunded rather than stranded on a dead "closed" counter.
  const closesBelowMinimum = b.status === 'closed' && current.status === 'open'
    && claimed < KAHATI_MIN_VIABLE_VIALS;
  // An explicit cancel releases the participants whatever the count.
  const cancels = b.status === 'cancelled' && current.status !== 'cancelled';

  if (closesBelowMinimum || cancels) {
    // Apply the non-status edits first so the cancelled row keeps them, then
    // run the same release flow the expiry sweep uses.
    const { status: _requested, ...rest } = patch;
    if (Object.keys(rest).length) {
      await db.update(groupBuys).set(rest).where(eq(groupBuys.id, id));
    }
    const result = await cancelKahati(db, id);
    if (result) {
      // Notify only after the database work settled.
      await notifyKahatiCancellations(result.notices);
      return ok(result.row);
    }
    // Another request cancelled it first; report the row as it stands.
    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
    return ok(row);
  }

  const [row] = await db.update(groupBuys).set(patch).where(eq(groupBuys.id, id)).returning();
  if (!row) throw new ApiError(404, 'Group buy not found.');

  // An edit that leaves the counter open but full closes the hatian and opens
  // the sibling batch, exactly as reaching the cap at checkout does. This keys
  // off the effective post-edit state — the admin form always sends a status,
  // so "status present" must not suppress the rule.
  if (row.status === 'open' && isKahatiFull(row.claimedSlots, row.totalSlots)) {
    const sealed = await closeFullKahati(db, row);
    return ok(sealed ?? row);
  }
  return ok(row);
});

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();
  // Participant orders keep line items pointing at this hatian; deleting it
  // would either break their history or bubble a raw FK violation. Refuse with
  // a clear next step instead.
  const [participant] = await db.select({ id: orderItems.id }).from(orderItems)
    .where(eq(orderItems.groupBuyId, id)).limit(1);
  if (participant) {
    throw new ApiError(409, 'This hatian has participant orders and cannot be deleted. Cancel it instead — that releases and refunds the participants.');
  }
  await db.delete(groupBuys).where(eq(groupBuys.id, id));
  return ok({ deleted: true });
});
