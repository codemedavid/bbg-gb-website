import { z } from 'zod';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { handler, ok } from '@/lib/api-response';
import { getDb, groupBuys, orderItems, orders, products } from '@/lib/db';
import { buildPasaloItems } from '@/lib/report/pasalo-items';

const querySchema = z.object({
  cycleKey: z.string().min(1).max(40),
}).strict();

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const params = new URL(req.url).searchParams;
  const { cycleKey } = querySchema.parse({
    ...Object.fromEntries(params),
  });
  const db = await getDb();
  const orderScope = eq(orders.cycleKey, cycleKey);
  const counters = await db.select({
    id: groupBuys.id, name: groupBuys.name, status: groupBuys.status,
    claimedSlots: groupBuys.claimedSlots, totalSlots: groupBuys.totalSlots,
    kahatiVials: groupBuys.kahatiVials, minViableVials: groupBuys.minViableVials,
    code: products.code, spec: products.spec,
  }).from(groupBuys).leftJoin(products, eq(products.id, groupBuys.productId)).where(or(
    eq(groupBuys.cycleKey, cycleKey),
    // Legacy counters without a cycle use their orders' batch membership.
    // Never widen an explicitly stamped counter to a different batch by date.
    and(isNull(groupBuys.cycleKey), sql`exists (
      select 1 from ${orderItems} inner join ${orders} on ${orders.id} = ${orderItems.orderId}
      where ${orderItems.groupBuyId} = ${groupBuys.id} and ${orderScope}
    )`),
  ));
  return ok({ items: buildPasaloItems(counters) });
});
