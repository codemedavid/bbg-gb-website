import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, categories } from '@/lib/db';

export const GET = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  return ok(await db.select().from(categories).orderBy(categories.sortOrder));
});
