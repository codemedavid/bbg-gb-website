// Applying an item edit to an order: counters, lines, totals.
//
// Two callers need this and they must not diverge. The admin correction surface
// (PATCH /api/admin/orders/[id]) can rewrite names and prices and add manual
// lines; the customer's own edit (PATCH /api/orders/[id]) can only change the
// quantity of a line it already has or drop it. What they SHARE is the part
// that is easy to get subtly wrong and expensive to get wrong twice: returning
// stock and slots when a quantity falls, taking them under a SQL guard when it
// rises, and re-deriving the order's money from the lines that survived.
//
// A second copy of this is how an order comes to be repriced one way by one
// route and another way by the other — so there is one copy, and the routes
// differ only in what they are allowed to ask for.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, orders, orderItems, products, groupBuys, moqCampaigns, moqProducts } from '@/lib/db';
import { ApiError } from '@/lib/session';
import { vialsForOrderLine } from '@/lib/kahati-server';
import { VIALS_PER_KIT, onHandUnitPrice, vialsFor, type OnHandUnit } from '@/lib/pricing';

/**
 * One line as it should stand after the edit.
 *
 * No `id` means a NEW line, and there are two kinds of those. One naming a
 * `productId` is a real catalog item: it draws stock, carries a USD price and
 * rolls up under that product in the weekly batch order. One without is a
 * free-text manual adjustment, which does none of those things — it is a note
 * with a price on it, and the admin surface says so.
 */
export type EditedOrderItem = {
  id?: string;
  nameSnapshot: string;
  specSnapshot?: string | null;
  qty: number;
  unitPricePhp: number;
  /** New lines only: link this line to a catalog product. */
  productId?: string | null;
  /** New product lines only: whether `qty` counts kits or single vials. */
  unit?: OnHandUnit;
};

type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
// Same shape lib/settlement-server.ts uses: a transaction handle is structurally
// the client, and typing it this way keeps both callers passing their own `tx`.
type Db = Awaited<ReturnType<typeof getDb>>;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Rewrite an order's lines and totals inside an open transaction.
 *
 * `items` is the complete intended line set: anything the order holds that is
 * not named here is removed, and its reservation returned. The caller has
 * already decided the order may be edited at all — status rules differ between
 * the admin and the customer, so they live with the callers.
 */
export async function applyOrderItemEdit(
  tx: Db,
  orderId: string,
  items: readonly EditedOrderItem[],
): Promise<{ order: OrderRow; items: OrderItemRow[] }> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found.');

  const existing = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const byId = new Map(existing.map((item) => [item.id, item]));
  const suppliedIds = items.flatMap((item) => item.id ? [item.id] : []);
  if (new Set(suppliedIds).size !== suppliedIds.length) {
    throw new ApiError(400, 'An order item was submitted more than once.');
  }
  for (const itemId of suppliedIds) {
    if (!byId.has(itemId)) throw new ApiError(400, 'An order item does not belong to this order.');
  }

  // Keep the operational counters in step with quantity corrections. Every
  // positive adjustment is guarded in SQL so concurrent edits cannot consume
  // stock/slots that are no longer available; negative adjustments return
  // exactly what checkout originally reserved.
  for (const old of existing) {
    const replacement = items.find((item) => item.id === old.id);
    const delta = (replacement?.qty ?? 0) - old.qty;
    if (delta === 0) continue;

    if (old.productId) {
      const vials = vialsForOrderLine(old.specSnapshot, Math.abs(delta));
      const [changed] = delta > 0
        ? await tx.update(products).set({
            stock: sql`${products.stock} - ${vials}`,
            soldCount: sql`${products.soldCount} + ${vials}`,
          }).where(and(eq(products.id, old.productId), sql`${products.stock} >= ${vials}`)).returning({ id: products.id })
        : await tx.update(products).set({
            stock: sql`${products.stock} + ${vials}`,
            soldCount: sql`GREATEST(${products.soldCount} - ${vials}, 0)`,
          }).where(eq(products.id, old.productId)).returning({ id: products.id });
      if (!changed) throw new ApiError(409, `Not enough stock to increase ${old.nameSnapshot}.`);
    } else if (old.moqProductId) {
      // The MOQ shelf has no ceiling to run out of, so editing a line just moves
      // the shared counter by the delta in either direction. Floored at zero so
      // an edit made after a cycle reset cannot leave the next round negative.
      await tx.update(moqProducts)
        .set({ committed: sql`GREATEST(${moqProducts.committed} + ${delta}, 0)` })
        .where(eq(moqProducts.id, old.moqProductId));
    } else if (old.moqCampaignId) {
      const [changed] = await tx.update(moqCampaigns)
        .set({ committed: sql`${moqCampaigns.committed} + ${delta}` })
        .where(and(
          eq(moqCampaigns.id, old.moqCampaignId),
          sql`${moqCampaigns.committed} + ${delta} >= 0`,
          sql`${moqCampaigns.committed} + ${delta} <= ${moqCampaigns.moq}`,
        )).returning({ id: moqCampaigns.id });
      if (!changed) throw new ApiError(409, `The batch has no room for that quantity of ${old.nameSnapshot}.`);
    } else if (old.groupBuyId) {
      const [changed] = await tx.update(groupBuys)
        .set({ claimedSlots: sql`${groupBuys.claimedSlots} + ${delta}` })
        .where(and(
          eq(groupBuys.id, old.groupBuyId),
          sql`${groupBuys.claimedSlots} + ${delta} >= 0`,
          sql`${groupBuys.claimedSlots} + ${delta} <= ${groupBuys.totalSlots}`,
        )).returning({ id: groupBuys.id });
      if (!changed) throw new ApiError(409, `The kahati has no room for that quantity of ${old.nameSnapshot}.`);
    }
  }

  const removedIds = existing
    .filter((item) => !suppliedIds.includes(item.id)).map((item) => item.id);
  if (removedIds.length) await tx.delete(orderItems).where(inArray(orderItems.id, removedIds));

  for (const item of items) {
    const lineTotal = round2(item.unitPricePhp * item.qty);
    if (item.id) {
      await tx.update(orderItems).set({
        nameSnapshot: item.nameSnapshot,
        specSnapshot: item.specSnapshot || null,
        qty: item.qty,
        unitPricePhp: String(item.unitPricePhp),
        lineTotalPhp: String(lineTotal),
      }).where(eq(orderItems.id, item.id));
    } else if (item.productId) {
      // A real catalog line, built the same way checkout builds one (see the
      // 'product' branch of app/api/orders/route.ts). Everything is snapshotted
      // from the PRODUCT ROW, never from the request: an admin adding an item
      // is recording what the customer is getting, not quoting a new price, and
      // a name typed into a box is how an order comes to hold a product the
      // weekly rollup cannot find.
      const [product] = await tx.select().from(products).where(eq(products.id, item.productId));
      if (!product) throw new ApiError(400, 'That product no longer exists.');

      const unit: OnHandUnit = item.unit ?? 'piece';
      const unitPricePhp = onHandUnitPrice(product, unit);
      // An unset or zero price means "not sold this way", never free.
      if (unitPricePhp == null) {
        throw new ApiError(400, `${product.name} ${product.spec} is not sold by the ${unit}.`);
      }

      // Draw the vials down inside the UPDATE, guard in the WHERE clause — the
      // same reason checkout does: two concurrent writes must not both pass a
      // stale stock check and oversell.
      const vials = vialsFor(unit, item.qty);
      const [drawn] = await tx.update(products)
        .set({
          soldCount: sql`${products.soldCount} + ${vials}`,
          stock: sql`${products.stock} - ${vials}`,
        })
        .where(and(eq(products.id, product.id), sql`${products.stock} >= ${vials}`))
        .returning({ id: products.id });
      if (!drawn) {
        throw new ApiError(409, `Only ${Math.max(product.stock, 0)} left in stock for ${product.name} ${product.spec}.`);
      }

      await tx.insert(orderItems).values({
        orderId,
        kind: 'product',
        productId: product.id,
        nameSnapshot: `${product.name} ${product.spec}`,
        specSnapshot: unit === 'kit' ? `On-hand · kit of ${VIALS_PER_KIT}` : 'On-hand · per piece',
        qty: item.qty,
        unitPricePhp: String(unitPricePhp),
        // The USD column prices a single vial; a kit line is worth a kit's worth.
        unitPriceUsd: product.priceUsd == null
          ? null
          : String(round2(Number(product.priceUsd) * vialsFor(unit, 1))),
        lineTotalPhp: String(round2(unitPricePhp * item.qty)),
      });
    } else {
      // Free-text manual adjustment: no product, so no stock movement and no
      // USD price. It exists so an admin can record a correction that the
      // catalog has no row for.
      const kind = order.buyType === 'kahati' ? 'group_buy'
        : order.buyType === 'group_buy' ? 'moq_campaign'
          : order.buyType === 'moq' ? 'moq_product' : 'product';
      await tx.insert(orderItems).values({
        orderId, kind,
        nameSnapshot: item.nameSnapshot,
        specSnapshot: item.specSnapshot || null,
        qty: item.qty,
        unitPricePhp: String(item.unitPricePhp),
        lineTotalPhp: String(lineTotal),
      });
    }
  }

  const finalItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const subtotal = finalItems.reduce((sum, item) => sum + Number(item.lineTotalPhp), 0);
  const totalUsd = finalItems.reduce((sum, item) => sum + Number(item.unitPriceUsd ?? 0) * item.qty, 0);
  // The packing fee is NOT re-derived from the edited lines. It buys a parcel,
  // and the parcel is still being packed — a customer who drops one vial has not
  // stopped needing it shipped, and one who was waived under the cycle rule must
  // not have the fee reappear because they touched their order.
  const packingFee = Number(order.packingFeePhp ?? 0);
  const legacyFees = packingFee > 0 ? 0 : Number(order.shippingPhp ?? 0) + Number(order.repackFeePhp ?? 0);
  const total = round2(subtotal + packingFee + legacyFees);

  const [updated] = await tx.update(orders).set({
    subtotalPhp: String(round2(subtotal)),
    totalPhp: String(total),
    totalUsd: String(round2(totalUsd)),
    updatedAt: new Date(),
  }).where(eq(orders.id, orderId)).returning();

  return { order: updated, items: finalItems };
}
