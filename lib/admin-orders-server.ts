// The admin order list, as one query so every screen that lists orders — the
// orders board and each cycle in the archive — shows the same columns.
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { getDb, orders, users } from '@/lib/db';

type Db = Awaited<ReturnType<typeof getDb>>;

export async function selectAdminOrders(db: Db, where: SQL[]) {
  const base = db.select({
    id: orders.id, orderNo: orders.orderNo, status: orders.status, buyType: orders.buyType,
    totalPhp: orders.totalPhp, shipName: orders.shipName, shipPhone: orders.shipPhone,
    trackingNo: orders.trackingNo, createdAt: orders.createdAt, customerEmail: users.email,
  }).from(orders).leftJoin(users, eq(orders.userId, users.id)).orderBy(desc(orders.createdAt));
  return where.length ? base.where(and(...where)) : base;
}
