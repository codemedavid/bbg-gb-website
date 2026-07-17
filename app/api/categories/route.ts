import { getDb, categories } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';

export const GET = handler(async () => {
  const db = await getDb();
  return ok(await db.select().from(categories).orderBy(categories.sortOrder));
});
