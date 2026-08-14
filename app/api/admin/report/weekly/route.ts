import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, products, groupBuys, moqCampaigns, users } from '@/lib/db';
import type { IncludedProduct } from '@/lib/types';
import {
  buildDateRangeReport, buildSegmentedDateRangeReport,
  type ReportItem, type ReportOrderInput,
} from '@/lib/report/build';
import { addDays, dateRangeBounds, isValidYmd, mondayOf, mostRecentFullWeekMonday } from '@/lib/report/week';

// GET /api/admin/report/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns an inclusive Manila-calendar date range. `week` remains supported for
// older callers and resolves to that seven-day period.
export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const params = new URL(req.url).searchParams;
  const week = params.get('week');
  const fallbackFrom = week && isValidYmd(week) ? mondayOf(week) : mostRecentFullWeekMonday(new Date());
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const from = rawFrom && isValidYmd(rawFrom) ? rawFrom : fallbackFrom;
  const to = rawTo && isValidYmd(rawTo) ? rawTo : addDays(from, 6);
  if (to < from) throw new ApiError(400, 'Report end date must be on or after the start date.');
  const { start, end } = dateRangeBounds(from, to);

  const db = await getDb();
  const orderRows = await db
    .select({
      id: orders.id, orderNo: orders.orderNo, status: orders.status, buyType: orders.buyType,
      createdAt: orders.createdAt, shipName: orders.shipName, shipPhone: orders.shipPhone,
      shipAddress: orders.shipAddress, courier: orders.courier, packedBy: orders.packedBy,
      paymentMethod: orders.paymentMethod, totalUsd: orders.totalUsd, totalPhp: orders.totalPhp,
      packingFeePhp: orders.packingFeePhp, shippingPhp: orders.shippingPhp, repackFeePhp: orders.repackFeePhp,
      customerEmail: users.email,
    })
    .from(orders)
    .leftJoin(users, eq(orders.userId, users.id))
    .where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)))
    .orderBy(desc(orders.createdAt));

  // One batched query for line items instead of N per order. The product join
  // carries `code` and `kit_size`, which the per-product rollup needs and the
  // item snapshots do not hold — it is a left join because kahati and MOQ lines
  // reference no product row.
  const ids = orderRows.map((o) => o.id);
  // A hatian line names no product — it references the counter — so it needs a
  // second hop to reach a kit size: order_item -> group_buy -> product. Aliased
  // because `products` is already joined for direct lines and one query cannot
  // join the same table twice under one name.
  const kahatiProducts = alias(products, 'kahati_products');
  const itemRows = ids.length
    ? await db
        .select({
          orderId: orderItems.orderId, kind: orderItems.kind, nameSnapshot: orderItems.nameSnapshot,
          specSnapshot: orderItems.specSnapshot, productId: orderItems.productId,
          qty: orderItems.qty, unitPriceUsd: orderItems.unitPriceUsd, unitPricePhp: orderItems.unitPricePhp,
          name: products.name, spec: products.spec, code: products.code,
          priceUsd: products.priceUsd, kitSize: products.kitSize,
          kahatiProductId: kahatiProducts.id,
          kahatiName: kahatiProducts.name, kahatiSpec: kahatiProducts.spec,
          kahatiCode: kahatiProducts.code, kahatiPriceUsd: kahatiProducts.priceUsd,
          kahatiKitSize: kahatiProducts.kitSize,
          kahatiVialCap: groupBuys.totalSlots,
          campaignIncludedProducts: moqCampaigns.includedProducts,
        })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(groupBuys, eq(orderItems.groupBuyId, groupBuys.id))
        .leftJoin(kahatiProducts, eq(groupBuys.productId, kahatiProducts.id))
        .leftJoin(moqCampaigns, eq(orderItems.moqCampaignId, moqCampaigns.id))
        .where(inArray(orderItems.orderId, ids))
    : [];

  // Campaign order items point at a batch rather than at its catalog products.
  // Resolve every included product in one query so Batch #1, #2, ... can roll
  // back up to stable product ids without adding one query per order line.
  const campaignProductIds = [...new Set(itemRows.flatMap((item) =>
    ((item.campaignIncludedProducts as IncludedProduct[] | null) ?? []).map((p) => p.productId),
  ))];
  const campaignProducts = campaignProductIds.length
    ? await db.select({
        id: products.id, name: products.name, spec: products.spec, code: products.code,
        priceUsd: products.priceUsd, kitSize: products.kitSize,
      }).from(products).where(inArray(products.id, campaignProductIds))
    : [];
  const campaignProductsById = new Map(campaignProducts.map((product) => [product.id, product]));

  const itemsByOrder = new Map<string, ReportItem[]>();
  for (const it of itemRows) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    const base = {
      // `kind` is what puts a line's order on the group-buy side of the report
      // split when orders.buy_type says 'solo' only because that is its default.
      kind: it.kind,
      unitPricePhp: it.unitPricePhp,
    };

    const included = ((it.campaignIncludedProducts as IncludedProduct[] | null) ?? [])
      .map((entry) => campaignProductsById.get(entry.productId))
      .filter((product): product is NonNullable<typeof product> => product != null);

    if (it.kind === 'moq_campaign' && included.length > 0) {
      for (const product of included) {
        // Campaign quantities are kits. Convert them to supplier units before
        // merging them with vial-counted Kahati lines; the builder then divides
        // by this same kit size for the visible Total Qty value.
        const qty = it.qty * product.kitSize;
        list.push({
          ...base,
          nameSnapshot: product.name, specSnapshot: product.spec, productId: product.id,
          code: product.code, kitSize: product.kitSize, qty,
          unitPriceUsd: product.priceUsd == null
            ? null
            : String(Number(product.priceUsd) / product.kitSize),
        });
      }
    } else if (it.kahatiProductId) {
      const kitSize = it.kahatiKitSize ?? it.kahatiVialCap;
      list.push({
        ...base,
        nameSnapshot: it.kahatiName!, specSnapshot: it.kahatiSpec,
        productId: it.kahatiProductId, code: it.kahatiCode, kitSize,
        qty: it.qty,
        unitPriceUsd: it.unitPriceUsd
          ?? (it.kahatiPriceUsd == null || !kitSize
            ? null
            : String(Number(it.kahatiPriceUsd) / kitSize)),
      });
    } else {
      list.push({
        ...base,
        nameSnapshot: it.name ?? it.nameSnapshot,
        specSnapshot: it.spec ?? it.specSnapshot,
        productId: it.productId,
        qty: it.qty, unitPriceUsd: it.unitPriceUsd,
        // A legacy unlinked Kahati still uses its vial cap as one supplier kit.
        code: it.code, kitSize: it.kitSize ?? it.kahatiVialCap,
      });
    }
    itemsByOrder.set(it.orderId, list);
  }

  const inputs: ReportOrderInput[] = orderRows.map((o) => ({
    orderNo: o.orderNo,
    status: o.status,
    buyType: o.buyType,
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
    // New orders use packing_fee_php. Older orders stored the same charge in
    // shipping/repack, so fold those columns in only when the new one is zero.
    packingFeePhp: String(Number(o.packingFeePhp) || (Number(o.shippingPhp) + Number(o.repackFeePhp))),
    items: itemsByOrder.get(o.id) ?? [],
  }));

  // `segments` is what the page renders and the exports download — on-hand and
  // group buy are separate reports because they answer separate questions.
  // `report` stays for the whole-week view; both are built from the one query.
  return ok({
    monday: from,
    from,
    to,
    report: buildDateRangeReport(from, to, inputs),
    segments: buildSegmentedDateRangeReport(from, to, inputs),
  });
});
