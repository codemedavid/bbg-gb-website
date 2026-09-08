import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, feedbackFolders } from '@/lib/db';
import { feedbackFolderSchema } from '@/lib/admin-schemas';
import { serializeFeedbackFolder } from '@/lib/feedback';
import { listFolders } from '@/lib/feedback-server';

// Shared by POST here and PATCH on [id]. A folder carries no file, so unlike
// the payment-method and MOQ forms this is plain JSON.
export function parseFolderBody(raw: unknown) {
  return feedbackFolderSchema.parse(raw);
}

// Every folder including the hidden ones: an admin has to be able to find a
// folder they pulled in order to put it back.
export const GET = handler(async () => {
  await requireAdmin();
  return ok(await listFolders({ activeOnly: false }));
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const b = parseFolderBody(await req.json());
  const db = await getDb();
  const [row] = await db.insert(feedbackFolders).values({
    name: b.name,
    description: b.description ?? null,
    isActive: b.isActive ?? true,
    sortOrder: b.sortOrder ?? 0,
  }).returning();
  // A folder is born empty, which is exactly why folders are rows.
  return ok(await serializeFeedbackFolder(row, []), 201);
});
