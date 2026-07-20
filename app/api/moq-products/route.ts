import { and, asc, eq } from 'drizzle-orm';
import { ok, handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';
import { getDb, moqProducts } from '@/lib/db';
import { serializeMoqProduct } from '@/lib/moq-products';
import { getMoqPageEnabled } from '@/lib/settings';

// Public MOQ shelf. The visibility toggle is enforced here, not only in the UI:
// while the page is switched off this 404s for everyone, so knowing the URL —
// or calling the API directly — reveals nothing. Browsing is anonymous; the
// purchase itself is gated at checkout like every other mode.
export const GET = handler(async () => {
  if (!(await getMoqPageEnabled())) throw new ApiError(404, 'Not found.');

  const db = await getDb();
  const rows = await db.select().from(moqProducts)
    .where(eq(moqProducts.isActive, true))
    .orderBy(asc(moqProducts.sortOrder), asc(moqProducts.createdAt));

  return ok(await Promise.all(rows.map(serializeMoqProduct)));
});
