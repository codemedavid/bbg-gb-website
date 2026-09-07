import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems } from '@/lib/db';
import { summarizeReportCycles, type CycleOrderRow } from '@/lib/report/cycles';

// GET /api/admin/report/cycles
//
// The batches the Reports page can scope itself to. A batch is a cycle, and a
// cycle opens at 22:00 Manila — so the range that holds exactly one batch is
// the range its own orders span, which only the orders can say.
//
// Read-only, and capped: the picker is for the batch being ordered from the
// supplier and the ones just behind it, not for the whole history.
const MAX_CYCLES = 8;

export const GET = handler(async () => {
  await requireAdmin();
  const db = await getDb();

  const orderRows = await db
    .select({
      id: orders.id, cycleKey: orders.cycleKey, createdAt: orders.createdAt, status: orders.status,
    })
    .from(orders)
    .where(isNotNull(orders.cycleKey))
    .orderBy(desc(orders.createdAt));

  // Vials in a second query rather than a correlated subquery: SUM comes back
  // as a string on one driver and a number on the other, and the report already
  // has enough places where those two disagree.
  const ids = orderRows.map((o) => o.id);
  const vialRows = ids.length
    ? await db
        .select({ orderId: orderItems.orderId, qty: orderItems.qty })
        .from(orderItems)
        // One and(), not two .where() calls: the second replaces the first,
        // which counted every on-hand line on a kahati order as vials.
        .where(and(eq(orderItems.kind, 'group_buy'), inArray(orderItems.orderId, ids)))
    : [];

  const vialsByOrder = new Map<string, number>();
  for (const item of vialRows) {
    vialsByOrder.set(item.orderId, (vialsByOrder.get(item.orderId) ?? 0) + item.qty);
  }

  const rows: CycleOrderRow[] = orderRows.map((o) => ({
    cycleKey: o.cycleKey,
    createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
    status: o.status,
    vials: vialsByOrder.get(o.id) ?? 0,
  }));

  return ok({ cycles: summarizeReportCycles(rows).slice(0, MAX_CYCLES) });
});
