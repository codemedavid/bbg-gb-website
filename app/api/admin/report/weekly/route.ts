import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, users } from '@/lib/db';
import { buildWeeklyReport, type ReportItem, type ReportOrderInput } from '@/lib/report/build';
import { isValidYmd, mondayOf, mostRecentFullWeekMonday, weekBounds } from '@/lib/report/week';

// GET /api/admin/report/weekly?week=YYYY-MM-DD
// Returns the built weekly report for the Mon–Sun week containing `week`
// (defaults to the most recent fully completed week).
export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const raw = new URL(req.url).searchParams.get('week');
  const monday = raw && isValidYmd(raw) ? mondayOf(raw) : mostRecentFullWeekMonday(new Date());
  const { start, end } = weekBounds(monday);

  const db = await getDb();
  const orderRows = await db
    .select({
      id: orders.id, orderNo: orders.orderNo, status: orders.status,
      createdAt: orders.createdAt, shipName: orders.shipName, shipPhone: orders.shipPhone,
      shipAddress: orders.shipAddress, courier: orders.courier, packedBy: orders.packedBy,
      paymentMethod: orders.paymentMethod, totalUsd: orders.totalUsd, totalPhp: orders.totalPhp,
      customerEmail: users.email,
    })
    .from(orders)
    .leftJoin(users, eq(orders.userId, users.id))
    .where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)))
    .orderBy(desc(orders.createdAt));

  // One batched query for line items instead of N per order.
  const ids = orderRows.map((o) => o.id);
  const itemRows = ids.length
    ? await db
        .select({
          orderId: orderItems.orderId, nameSnapshot: orderItems.nameSnapshot,
          qty: orderItems.qty, unitPriceUsd: orderItems.unitPriceUsd, unitPricePhp: orderItems.unitPricePhp,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, ids))
    : [];
  const itemsByOrder = new Map<string, ReportItem[]>();
  for (const it of itemRows) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    list.push({ nameSnapshot: it.nameSnapshot, qty: it.qty, unitPriceUsd: it.unitPriceUsd, unitPricePhp: it.unitPricePhp });
    itemsByOrder.set(it.orderId, list);
  }

  const inputs: ReportOrderInput[] = orderRows.map((o) => ({
    orderNo: o.orderNo,
    status: o.status,
    createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
    shipName: o.shipName,
    shipPhone: o.shipPhone,
    customerEmail: o.customerEmail ?? null,
    shipAddress: o.shipAddress,
    courier: o.courier,
    packedBy: o.packedBy,
    paymentMethod: o.paymentMethod,
    totalUsd: o.totalUsd,
    totalPhp: o.totalPhp,
    items: itemsByOrder.get(o.id) ?? [],
  }));

  return ok({ monday, report: buildWeeklyReport(monday, inputs) });
});
