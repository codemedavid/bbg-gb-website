import { eq } from 'drizzle-orm';
import { getDb, coaFiles } from '@/lib/db';
import { handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';
import { siteFileUrl } from '@/lib/file-url';
import { BUCKETS } from '@/lib/env';

export const GET = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const [coa] = await db.select().from(coaFiles).where(eq(coaFiles.id, id));
  if (!coa) throw new ApiError(404, "COA not available for this batch yet. Message us and we'll send it over.");
  // Redirected to THIS site's file route, never to the storage host. signedUrl
  // would hand back an ik.imagekit.io URL in production, which navigates the
  // customer off bbgph.org to read the document that is supposed to prove we
  // tested the batch. Resolved against the request origin because
  // Response.redirect only accepts absolute URLs.
  return Response.redirect(new URL(siteFileUrl(BUCKETS.coa, coa.storageKey), req.url));
});
