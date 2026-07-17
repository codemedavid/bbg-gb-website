import { readLocal } from '@/lib/storage';
import { handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
};

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ bucket: string; key: string[] }> }) => {
  await requireSession(); // proofs are private
  const { bucket, key } = await ctx.params;
  const path = key.join('/');
  if (!path || path.includes('..')) throw new ApiError(400, 'Bad file path.');
  try {
    const buf = await readLocal(bucket, path);
    const ext = path.split('.').pop()?.toLowerCase() || '';
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream' } });
  } catch {
    throw new ApiError(404, 'File not found.');
  }
});
