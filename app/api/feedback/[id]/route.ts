import { ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getFolderWithItems } from '@/lib/feedback-server';

// Public: one folder and its visible screenshots.
//
// A hidden folder 404s rather than 403s. There is nothing to authenticate into
// — the point is that the URL of a folder someone pulled must not keep working
// for whoever already had the link.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const folder = await getFolderWithItems(id, { activeOnly: true });
  if (!folder) throw new ApiError(404, 'Feedback folder not found.');
  const { isActive, sortOrder, ...rest } = folder;
  return ok(rest);
});
