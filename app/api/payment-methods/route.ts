import { asc, eq } from 'drizzle-orm';
import { getDb, paymentMethods } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { serializePaymentMethod } from '@/lib/payment-methods';

// Public: active payment methods shown at checkout, ordered by admin sort order.
export const GET = handler(async () => {
  const db = await getDb();
  const rows = await db.select().from(paymentMethods)
    .where(eq(paymentMethods.isActive, true))
    .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.createdAt));
  const methods = await Promise.all(rows.map(serializePaymentMethod));
  return ok(methods.map(({ isActive, sortOrder, ...m }) => m));
});
