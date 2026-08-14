import { z } from 'zod';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, orderPaymentProofs, orderStatusHistory, users, products, groupBuys, moqCampaigns, moqProducts } from '@/lib/db';
import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { vialsForOrderLine } from '@/lib/kahati-server';
import { orderUpdatedEmail, sendEmail } from '@/lib/email';

const editableItemSchema = z.object({
  id: z.string().uuid().optional(),
  nameSnapshot: z.string().trim().min(1).max(200),
  specSnapshot: z.string().trim().max(120).nullable().optional(),
  qty: z.number().int().positive().max(9999),
  unitPricePhp: z.number().nonnegative().max(10_000_000),
});

const editSchema = z.object({
  items: z.array(editableItemSchema).min(1).max(200),
});

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw new ApiError(404, 'Order not found.');
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  const history = await db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(orderStatusHistory.createdAt);
  const [customer] = await db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, order.userId));
  // Every proof the customer attached. A ₱4,500 order paid in three transfers
  // has three screenshots, and any one of them alone reads as underpaid — so
  // the admin verifying the payment gets the whole set, each with its own
  // signed URL to open.
  const proofRows = await db.select().from(orderPaymentProofs)
    .where(eq(orderPaymentProofs.orderId, id))
    .orderBy(asc(orderPaymentProofs.sortOrder));
  const proofs = await Promise.all(proofRows.map(async (p) => ({
    id: p.id,
    url: await signedUrl(BUCKETS.proofs, p.storageKey),
    sortOrder: p.sortOrder,
    amountPhp: p.amountPhp,
    reference: p.reference,
    uploadedAt: p.uploadedAt,
  })));
  // Kept alongside the list: other readers still take the single key, and
  // removing it here would be a rewrite of all of them in the same change.
  const proofUrl = order.paymentProofKey ? await signedUrl(BUCKETS.proofs, order.paymentProofKey) : null;
  return ok({ order, items, history, customer, proofUrl, proofs });
});

// Admin correction surface for an order before fulfilment. Existing reference
// columns are retained, while new rows are explicit manual adjustments: this
// edits the commercial record without pretending a free-text line came from a
// stock or group-buy counter.
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const body = editSchema.parse(await req.json());
  const db = await getDb();

  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id));
    if (!order) throw new ApiError(404, 'Order not found.');
    if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
      throw new ApiError(409, 'Shipped, delivered, or cancelled orders can no longer be edited.');
    }

    const existing = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));
    const byId = new Map(existing.map((item) => [item.id, item]));
    const suppliedIds = body.items.flatMap((item) => item.id ? [item.id] : []);
    if (new Set(suppliedIds).size !== suppliedIds.length) throw new ApiError(400, 'An order item was submitted more than once.');
    for (const itemId of suppliedIds) {
      if (!byId.has(itemId)) throw new ApiError(400, 'An order item does not belong to this order.');
    }

    // Keep the operational counters in step with quantity corrections. Every
    // positive adjustment is guarded in SQL so concurrent edits cannot consume
    // stock/slots that are no longer available; negative adjustments return
    // exactly what checkout originally reserved.
    for (const old of existing) {
      const replacement = body.items.find((item) => item.id === old.id);
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
        const amount = Math.abs(delta);
        const [changed] = delta > 0
          ? await tx.update(moqProducts).set({ stock: sql`${moqProducts.stock} - ${amount}` })
              .where(and(eq(moqProducts.id, old.moqProductId), sql`${moqProducts.stock} >= ${amount}`)).returning({ id: moqProducts.id })
          : await tx.update(moqProducts).set({ stock: sql`${moqProducts.stock} + ${amount}` })
              .where(eq(moqProducts.id, old.moqProductId)).returning({ id: moqProducts.id });
        if (!changed) throw new ApiError(409, `Not enough stock to increase ${old.nameSnapshot}.`);
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

    const removedIds = existing.filter((item) => !suppliedIds.includes(item.id)).map((item) => item.id);
    if (removedIds.length) await tx.delete(orderItems).where(inArray(orderItems.id, removedIds));

    for (const item of body.items) {
      const lineTotal = Math.round(item.unitPricePhp * item.qty * 100) / 100;
      if (item.id) {
        await tx.update(orderItems).set({
          nameSnapshot: item.nameSnapshot,
          specSnapshot: item.specSnapshot || null,
          qty: item.qty,
          unitPricePhp: String(item.unitPricePhp),
          lineTotalPhp: String(lineTotal),
        }).where(eq(orderItems.id, item.id));
      } else {
        const kind = order.buyType === 'kahati' ? 'group_buy'
          : order.buyType === 'group_buy' ? 'moq_campaign'
            : order.buyType === 'moq' ? 'moq_product' : 'product';
        await tx.insert(orderItems).values({
          orderId: id, kind,
          nameSnapshot: item.nameSnapshot,
          specSnapshot: item.specSnapshot || null,
          qty: item.qty,
          unitPricePhp: String(item.unitPricePhp),
          lineTotalPhp: String(lineTotal),
        });
      }
    }

    const finalItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));
    const subtotal = finalItems.reduce((sum, item) => sum + Number(item.lineTotalPhp), 0);
    const totalUsd = finalItems.reduce((sum, item) => sum + Number(item.unitPriceUsd ?? 0) * item.qty, 0);
    const packingFee = Number(order.packingFeePhp ?? 0);
    const legacyFees = packingFee > 0 ? 0 : Number(order.shippingPhp ?? 0) + Number(order.repackFeePhp ?? 0);
    const total = Math.round((subtotal + packingFee + legacyFees) * 100) / 100;

    const [updated] = await tx.update(orders).set({
      subtotalPhp: String(Math.round(subtotal * 100) / 100),
      totalPhp: String(total),
      totalUsd: String(Math.round(totalUsd * 100) / 100),
      updatedAt: new Date(),
    }).where(eq(orders.id, id)).returning();
    await tx.insert(orderStatusHistory).values({
      orderId: id,
      status: order.status,
      note: 'Admin edited order items and totals',
    });
    return { order: updated, items: finalItems };
  });

  const [customer] = await db.select({ name: users.name, email: users.email })
    .from(users).where(eq(users.id, result.order.userId));
  if (customer) {
    const packingFee = Number(result.order.packingFeePhp ?? 0)
      || Number(result.order.shippingPhp ?? 0) + Number(result.order.repackFeePhp ?? 0);
    await sendEmail({
      to: customer.email,
      ...orderUpdatedEmail({
        name: customer.name,
        orderNo: result.order.orderNo,
        subtotal: Number(result.order.subtotalPhp),
        packingFee,
        total: Number(result.order.totalPhp),
        items: result.items.map((item) => ({
          name: item.nameSnapshot, qty: item.qty, unitPrice: Number(item.unitPricePhp),
          lineTotal: Number(item.lineTotalPhp),
        })),
      }),
      kind: 'order_receipt_updated',
    });
  }

  return ok(result);
});
