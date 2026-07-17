import { desc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, users } from '@/lib/db';

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const status = new URL(req.url).searchParams.get('status');
  const db = await getDb();
  const base = db.select({
    id: orders.id, orderNo: orders.orderNo, status: orders.status, buyType: orders.buyType,
    totalPhp: orders.totalPhp, shipName: orders.shipName, shipPhone: orders.shipPhone,
    trackingNo: orders.trackingNo, createdAt: orders.createdAt, customerEmail: users.email,
  }).from(orders).leftJoin(users, eq(orders.userId, users.id)).orderBy(desc(orders.createdAt));
  return ok(status ? await base.where(eq(orders.status, status as never)) : await base);
});
