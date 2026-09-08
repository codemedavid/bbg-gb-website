import { and, asc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, products, groupBuys, users } from '@/lib/db';
import { num } from '@/lib/report/money';
import { dateRangeBounds, isValidYmd, manilaYmd } from '@/lib/report/week';
import {
  parseShortfallPaste, buildRefundRows, refundSummary,
  type RefundOrderLine,
} from '@/lib/report/refund';

// POST /api/admin/report/refund
//
// Who to pay back when a batch arrives short. The admin pastes the supplier's
// refund sheet — SKU, kits, pesos, and no customer column — and gets it joined
// to the batch's own order lines, so the file that leaves here carries a name,
// a phone and an email against every peso.
//
// A POST rather than a GET because the pasted sheet is the input and it does
// not belong in a URL; nothing here writes.
//
// Scoped by BATCH where there is one to scope by. A cycle opens at 22:00
// Manila, so no From/To a person types reproduces one — the range either clips
// the evening the batch opened or swallows the evening the next one did, and
// the shortfall gets joined to buyers from a batch that was never short.
// orders.cycle_key is the batch's identity, so when the admin has picked one
// from the Reports batch picker that key is the filter and the dates only
// label the file.
const bodySchema = z.object({
  from: z.string().refine(isValidYmd, 'Start date must be YYYY-MM-DD.'),
  to: z.string().refine(isValidYmd, 'End date must be YYYY-MM-DD.'),
  /** The supplier sheet, copied straight out of Excel. */
  paste: z.string().min(1, 'Paste the refund sheet first.'),
  // Which halves of the batch to search. A hatian shortfall is the usual case,
  // so that is the default; a campaign batch can come up short too, and then
  // the admin says so rather than the export quietly missing those buyers.
  buyTypes: z.array(z.enum(['kahati', 'group_buy', 'moq', 'solo'])).min(1).optional(),
  // The batch, from the Reports page's picker. Absent for a hand-typed range
  // and for every order placed before cycles were stamped — those belong to no
  // batch, and the window is the only thing that can hold them.
  cycleKey: z.string().trim().min(1).max(40).optional(),
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const { from, to, paste, buyTypes = ['kahati'], cycleKey } = bodySchema.parse(await req.json());
  if (to < from) throw new ApiError(400, 'Batch end date must be on or after the start date.');

  const { rows: shortfalls, skipped } = parseShortfallPaste(paste);
  if (!shortfalls.length) {
    throw new ApiError(400, 'No SKU rows could be read from that paste. Expect: label, kits, amount.');
  }

  const db = await getDb();

  // One or the other, never both. Intersecting them would re-introduce the leak
  // from the other side: the batch's own opening-evening orders sit before the
  // date the admin types, and an AND would silently drop the very buyers the
  // cycle key was chosen to keep.
  const { start, end } = dateRangeBounds(from, to);
  const batchScope: SQL | undefined = cycleKey
    ? eq(orders.cycleKey, cycleKey)
    : and(gte(orders.createdAt, start), lt(orders.createdAt, end));

  // A hatian line names a counter, not a product, so its codes are one hop
  // further out: order_item -> group_buy -> product. Aliased because `products`
  // is already joined for direct lines and one query cannot join it twice
  // under one name — the same arrangement the weekly report uses.
  const kahatiProducts = alias(products, 'kahati_products');
  const rows = await db
    .select({
      orderNo: orders.orderNo,
      orderStatus: orders.status,
      createdAt: orders.createdAt,
      // The delivery snapshot first: it is who the parcel was actually for, and
      // it cannot change under an admin looking at a batch already packed. The
      // account name is the fallback for a line with no snapshot.
      shipName: orders.shipName,
      shipPhone: orders.shipPhone,
      customerName: users.name,
      customerEmail: users.email,
      customerPhone: users.phone,
      productLabel: orderItems.nameSnapshot,
      qty: orderItems.qty,
      lineTotalPhp: orderItems.lineTotalPhp,
      supplierCode: products.supplierCode,
      productCode: products.code,
      kahatiSupplierCode: kahatiProducts.supplierCode,
      kahatiProductCode: kahatiProducts.code,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(products, eq(products.id, orderItems.productId))
    .leftJoin(groupBuys, eq(groupBuys.id, orderItems.groupBuyId))
    .leftJoin(kahatiProducts, eq(kahatiProducts.id, groupBuys.productId))
    .where(and(batchScope, inArray(orders.buyType, buyTypes)))
    .orderBy(asc(orders.createdAt));

  const lines: RefundOrderLine[] = rows.map((r) => ({
    orderNo: r.orderNo,
    orderStatus: r.orderStatus,
    customerName: r.shipName || r.customerName,
    customerPhone: r.shipPhone || r.customerPhone || '',
    customerEmail: r.customerEmail,
    productLabel: r.productLabel,
    supplierCode: r.supplierCode ?? r.kahatiSupplierCode ?? null,
    productCode: r.productCode ?? r.kahatiProductCode ?? null,
    qty: r.qty,
    lineTotalPhp: num(r.lineTotalPhp),
    orderedOn: manilaYmd(r.createdAt),
  }));

  const refundRows = buildRefundRows(shortfalls, lines);

  return ok({
    from, to,
    // Echoed so the screen and the CSV can name what they actually covered —
    // a file labelled by dates it did not filter on is how the next admin
    // reconciles the wrong batch.
    cycleKey: cycleKey ?? null,
    rows: refundRows,
    summary: refundSummary(refundRows),
    // Handed back so the admin can see what the parser ignored. A title row is
    // fine to drop; a SKU row silently dropped is a customer who goes unpaid.
    skipped,
  });
});
