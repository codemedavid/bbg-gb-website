import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, coaFiles } from '@/lib/db';

// Deleting is how a COA is unpublished — see lib/coa-server.ts for why there is
// no hide toggle. The stored file is left in the bucket rather than removed with
// the row: nothing links to it once the row is gone, and the same restraint is
// what has let a mis-deleted payment proof be recovered before.
export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireAdmin();
  const db = await getDb();
  const [row] = await db.delete(coaFiles).where(eq(coaFiles.id, id)).returning();
  if (!row) throw new ApiError(404, 'COA not found.');
  return ok({ id });
});
