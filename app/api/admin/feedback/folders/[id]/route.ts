import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, feedbackFolders } from '@/lib/db';
import { getFolderWithItems } from '@/lib/feedback-server';
import { parseFolderBody } from '../route';

// One folder with everything filed in it, hidden screenshots included. That
// inclusion is the entire difference from the public route of the same shape —
// an admin has to be able to see and unhide what they pulled.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireAdmin();
  const folder = await getFolderWithItems(id, { activeOnly: false });
  if (!folder) throw new ApiError(404, 'Feedback folder not found.');
  return ok(folder);
});

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireAdmin();
  const b = parseFolderBody(await req.json());
  const db = await getDb();

  const [row] = await db.update(feedbackFolders).set({
    name: b.name,
    isActive: b.isActive ?? true,
    sortOrder: b.sortOrder ?? 0,
    // Absent means "leave it alone"; an empty string means "clear it" — the
    // same distinction payment-method instructions draw.
    ...(b.description !== undefined ? { description: b.description } : {}),
  }).where(eq(feedbackFolders.id, id)).returning();
  if (!row) throw new ApiError(404, 'Feedback folder not found.');

  // Re-read so the response carries the folder's current count and cover
  // rather than the empty pair a bare row would serialize to.
  return ok(await getFolderWithItems(id, { activeOnly: false }));
});

// Deletes the folder and, by the cascade in migration 0032, every screenshot
// filed in it. The admin UI names that count before it calls this.
export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireAdmin();
  const db = await getDb();
  const [row] = await db.delete(feedbackFolders).where(eq(feedbackFolders.id, id)).returning();
  if (!row) throw new ApiError(404, 'Feedback folder not found.');
  return ok({ id });
});
