import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys, moqProducts, orders, orderItems, products, users } from '@/lib/db';
import { buildWeeklyReport, type ReportItem, type ReportOrderInput } from '@/lib/report/build';
import { reportProductCode } from '@/lib/report/product-codes';
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
      buyType: orders.buyType,
      createdAt: orders.createdAt, shipName: orders.shipName, shipPhone: orders.shipPhone,
      shipAddress: orders.shipAddress, courier: orders.courier, packedBy: orders.packedBy,
      paymentMethod: orders.paymentMethod, totalUsd: orders.totalUsd, totalPhp: orders.totalPhp,
      packingFeePhp: orders.packingFeePhp,
      customerEmail: users.email,
    })
    .from(orders)
    .leftJoin(users, eq(orders.userId, users.id))
    .where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)))
    .orderBy(desc(orders.createdAt));

  // One batched query for line items instead of N per order.
  const ids = orderRows.map((o) => o.id);
  const directProduct = alias(products, 'report_direct_product');
  const groupProduct = alias(products, 'report_group_product');
  const itemRows = ids.length
    ? await db
        .select({
          orderId: orderItems.orderId, nameSnapshot: orderItems.nameSnapshot,
          specSnapshot: orderItems.specSnapshot,
          qty: orderItems.qty, unitPriceUsd: orderItems.unitPriceUsd, unitPricePhp: orderItems.unitPricePhp,
          directCode: directProduct.code, directName: directProduct.name, directSpec: directProduct.spec,
          groupCode: groupProduct.code, groupName: groupProduct.name, groupSpec: groupProduct.spec,
          moqName: moqProducts.name, moqSpec: moqProducts.spec,
        })
        .from(orderItems)
        .leftJoin(directProduct, eq(orderItems.productId, directProduct.id))
        .leftJoin(groupBuys, eq(orderItems.groupBuyId, groupBuys.id))
        .leftJoin(groupProduct, eq(groupBuys.productId, groupProduct.id))
        .leftJoin(moqProducts, eq(orderItems.moqProductId, moqProducts.id))
        .where(inArray(orderItems.orderId, ids))
    : [];
  const itemsByOrder = new Map<string, ReportItem[]>();
  for (const it of itemRows) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    const productName = it.directName ?? it.groupName ?? it.moqName ?? it.nameSnapshot;
    const productSpec = it.directSpec ?? it.groupSpec ?? it.moqSpec ?? it.specSnapshot;
    const storedCode = it.directCode ?? it.groupCode;
    list.push({
      code: reportProductCode(productName, productSpec, storedCode),
      nameSnapshot: it.nameSnapshot,
      qty: it.qty,
      unitPriceUsd: it.unitPriceUsd,
      unitPricePhp: it.unitPricePhp,
    });
    itemsByOrder.set(it.orderId, list);
  }

  const inputs: ReportOrderInput[] = orderRows.map((o) => ({
    orderNo: o.orderNo,
    buyType: o.buyType,
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
    packingFeePhp: o.packingFeePhp,
    items: itemsByOrder.get(o.id) ?? [],
  }));

  return ok({ monday, report: buildWeeklyReport(monday, inputs) });
});
