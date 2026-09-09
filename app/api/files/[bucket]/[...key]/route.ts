import { readFile } from '@/lib/storage';
import { handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { isPublicBucket } from '@/lib/file-url';

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
};

// Every file this site shows, served from this site.
//
// Two audiences meet on one route. Reviews and COAs are galleries built to be
// opened and looked at by anyone, so they are served to a logged-out visitor;
// payment proofs are screenshots of people's bank apps and are not. Which is
// which is an allowlist in lib/file-url.ts, so a bucket added later is private
// until somebody deliberately publishes it.
//
// The bytes are read through the storage driver rather than off local disk:
// production keeps these in ImageKit, and the point of this route is that the
// browser never has to go there.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ bucket: string; key: string[] }> }) => {
  const { bucket, key } = await ctx.params;
  const path = key.join('/');
  // Checked BEFORE the session, so a traversal attempt is refused as the bad
  // path it is rather than reported as an authentication problem.
  if (!path || path.includes('..')) throw new ApiError(400, 'Bad file path.');
  if (!isPublicBucket(bucket)) await requireSession();

  try {
    const buf = await readFile(bucket, path);
    const ext = path.split('.').pop()?.toLowerCase() || '';
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        // A stored file never changes under its key — a new upload gets a new
        // one — so it can be cached hard. This is also what stops the proxy
        // costing a storage fetch per scroll.
        'Cache-Control': isPublicBucket(bucket)
          ? 'public, max-age=31536000, immutable'
          : 'private, max-age=300',
      },
    });
  } catch {
    throw new ApiError(404, 'File not found.');
  }
});
