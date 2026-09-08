import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, feedbackItems } from '@/lib/db';
import { validateAndStoreImage } from '@/lib/uploads';
import { serializeFeedbackItem } from '@/lib/feedback';
import { BUCKETS } from '@/lib/env';
import { parseItemForm, requireFolder } from '../route';

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireAdmin();
  const form = await req.formData();
  const b = parseItemForm(form);
  await requireFolder(b.folderId);

  // Only replace the screenshot when a new file is provided; otherwise keep the
  // stored one, so editing a typo in a caption cannot blank the image.
  const image = form.get('image');
  const newKey = image instanceof File && image.size > 0
    ? await validateAndStoreImage(image, BUCKETS.feedback)
    : undefined;

  const db = await getDb();
  const [row] = await db.update(feedbackItems).set({
    folderId: b.folderId,
    isActive: b.isActive ?? true,
    sortOrder: b.sortOrder ?? 0,
    ...(b.caption !== undefined ? { caption: b.caption } : {}),
    ...(b.customerName !== undefined ? { customerName: b.customerName } : {}),
    ...(newKey !== undefined ? { imageKey: newKey } : {}),
  }).where(eq(feedbackItems.id, id)).returning();
  if (!row) throw new ApiError(404, 'Feedback not found.');
  return ok(await serializeFeedbackItem(row));
});

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireAdmin();
  const db = await getDb();
  const [row] = await db.delete(feedbackItems).where(eq(feedbackItems.id, id)).returning();
  if (!row) throw new ApiError(404, 'Feedback not found.');
  return ok({ id });
});
