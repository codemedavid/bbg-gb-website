import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, feedbackFolders, feedbackItems } from '@/lib/db';
import { feedbackItemSchema } from '@/lib/admin-schemas';
import { validateAndStoreImage } from '@/lib/uploads';
import { serializeFeedbackItem } from '@/lib/feedback';
import { BUCKETS } from '@/lib/env';

// Parses the multipart text fields. The screenshot is handled separately, by
// lib/uploads, which is what validates its type and size.
export function parseItemForm(form: FormData) {
  const caption = form.get('caption');
  const customerName = form.get('customerName');
  const isActive = form.get('isActive');
  const sortOrder = form.get('sortOrder');
  return feedbackItemSchema.parse({
    folderId: form.get('folderId'),
    // Empty string means "no caption", not an empty caption to render.
    caption: caption == null ? undefined : String(caption).trim() || null,
    customerName: customerName == null ? undefined : String(customerName).trim() || null,
    isActive: isActive == null ? undefined : isActive === 'true',
    sortOrder: sortOrder == null || sortOrder === '' ? undefined : Number(sortOrder),
  });
}

// Checked explicitly rather than left to the foreign key. A raw FK violation
// surfaces as a 500 "Something went wrong", which tells an admin nothing about
// the folder that was deleted out from under the form they had open.
export async function requireFolder(id: string): Promise<void> {
  const db = await getDb();
  const [folder] = await db.select({ id: feedbackFolders.id })
    .from(feedbackFolders).where(eq(feedbackFolders.id, id));
  if (!folder) throw new ApiError(404, 'Feedback folder not found.');
}

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const form = await req.formData();
  const b = parseItemForm(form);
  await requireFolder(b.folderId);

  // The screenshot IS the feedback, so unlike an edit a new one cannot be
  // created without it — there is no stored image to fall back on.
  const image = form.get('image');
  if (!(image instanceof File) || image.size === 0) {
    throw new ApiError(400, 'A feedback screenshot is required.');
  }
  const imageKey = await validateAndStoreImage(image, BUCKETS.feedback);

  const db = await getDb();
  const [row] = await db.insert(feedbackItems).values({
    folderId: b.folderId,
    imageKey,
    caption: b.caption ?? null,
    customerName: b.customerName ?? null,
    isActive: b.isActive ?? true,
    sortOrder: b.sortOrder ?? 0,
  }).returning();
  return ok(await serializeFeedbackItem(row), 201);
});
