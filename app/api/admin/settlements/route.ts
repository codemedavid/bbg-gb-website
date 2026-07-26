import { desc, eq, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, settlements, users } from '@/lib/db';

// Admin: every hatian final checkout, newest first. `orderCount` is how many
// completed hatian orders the one packing fee covers — the figure that shows at
// a glance the fee was charged per parcel, not per commitment.
export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const status = new URL(req.url).searchParams.get('status');
  const db = await getDb();

  const base = db.select({
    id: settlements.id,
    status: settlements.status,
    packingFeePhp: settlements.packingFeePhp,
    balancePhp: settlements.balancePhp,
    totalPhp: settlements.totalPhp,
    paymentMethod: settlements.paymentMethod,
    paymentProofKey: settlements.paymentProofKey,
    createdAt: settlements.createdAt,
    paidAt: settlements.paidAt,
    customerName: users.name,
    customerEmail: users.email,
    orderCount: sql<number>`(select count(*)::int from ${orders} where ${orders.settlementId} = ${settlements.id})`,
  })
    .from(settlements)
    .leftJoin(users, eq(settlements.userId, users.id))
    .orderBy(desc(settlements.createdAt));

  return ok(status ? await base.where(eq(settlements.status, status as never)) : await base);
});
