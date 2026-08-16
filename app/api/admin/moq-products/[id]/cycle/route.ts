import { and, eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqProducts } from '@/lib/db';
import { serializeMoqProduct } from '@/lib/moq-products';
import { closedCycle } from '@/lib/moq-product-cycle';

// Close the round that is accumulating and open the next one.
//
// This is the admin recording a fact about the world: the buy was placed with
// the supplier. Everything committed so far belongs to that placed order — the
// lines keep their cycle number and read as 'processing' from here on — and the
// counter starts again from zero for the next round.
//
// Deliberately a decision and not an automatic consequence of reaching the
// target. Hitting the MOQ means the buy CAN go ahead, not that anyone has sent
// it yet; auto-rolling on the last order would tell that customer the supplier
// order exists before a human had done anything about it.
//
// Closing short of the target is allowed for the same reason: the admin may
// place a buy that never quite filled, and that decision has to be recordable.
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();

  const [existing] = await db.select().from(moqProducts).where(eq(moqProducts.id, id));
  if (!existing) throw new ApiError(404, 'MOQ product not found.');

  // Guarded on the cycle number the read saw, so two admins clicking at the same
  // moment advance the round exactly once between them. Without the guard both
  // writes land and the shelf jumps from round 1 to round 3 — stranding every
  // order that recorded round 2 in a cycle nothing ever collected for.
  const [row] = await db.update(moqProducts)
    .set(closedCycle(existing))
    .where(and(eq(moqProducts.id, id), eq(moqProducts.cycleNo, existing.cycleNo)))
    .returning();

  // Lost the race: the other click already opened the round this one intended
  // to open, which is the outcome asked for. Answer with what the shelf holds
  // now rather than erroring on a button that did what it said.
  if (!row) return ok(await serializeMoqProduct((await db.select().from(moqProducts).where(eq(moqProducts.id, id)))[0]));

  return ok(await serializeMoqProduct(row));
});
