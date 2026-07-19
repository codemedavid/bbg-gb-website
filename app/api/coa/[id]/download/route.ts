import { eq } from 'drizzle-orm';
import { getDb, coaFiles } from '@/lib/db';
import { handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';
import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';

export const GET = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const [coa] = await db.select().from(coaFiles).where(eq(coaFiles.id, id));
  if (!coa) throw new ApiError(404, "COA not available for this batch yet. Message us and we'll send it over.");
  // The local storage driver returns a relative path; resolve against the request
  // origin because Response.redirect only accepts absolute URLs.
  return Response.redirect(new URL(await signedUrl(BUCKETS.coa, coa.storageKey), req.url));
});
