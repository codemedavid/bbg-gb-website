import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, orderStatusHistory, groupBuys, moqCampaigns, moqProducts, products, users } from '@/lib/db';
import { ORDER_STATUS_FLOW } from '@/lib/db/schema';
import { vialsForOrderLine } from '@/lib/kahati-server';
import { sendEmail, orderStatusEmail } from '@/lib/email';
import { captureEvent, orderStatusEvent } from '@/lib/posthog';
import { STATUS_LABEL } from '@/lib/order-status';
import { PAYMENT_STATUSES, type PaymentStatus } from '@/lib/payment-status';
import { checkoutLog } from '@/lib/checkout-log';
import { JOINABLE_KAHATI_STATUSES } from '@/lib/pasalo';

const schema = z.object({
  status: z.enum([...ORDER_STATUS_FLOW, 'cancelled'] as [string, ...string[]]),
  // The admin's verdict on the MONEY, separate from the parcel's progress.
  // Optional: most status changes are about fulfilment and leave the payment
  // verdict where it was. When absent, paymentVerdictFor derives the obvious
  // one from the fulfilment move.
  paymentStatus: z.enum(PAYMENT_STATUSES as unknown as [string, ...string[]]).optional(),
  trackingNo: z.string().max(80).optional(),
  note: z.string().max(500).optional(),
  // Weekly-report fulfilment fields (admin-editable, optional).
  courier: z.string().max(40).optional(),
  packedBy: z.string().max(60).optional(),
  paymentMethod: z.string().max(40).optional(),
});


/**
 * The payment verdict this status change implies.
 *
 * An admin moving an order INTO 'payment_confirmed' is the act of verifying
 * money — that is what the button means on the admin board, and it is the only
 * place in the system a payment may become 'confirmed'. Cancelling ends any
 * obligation, so nothing is collectable. Every other fulfilment move (shipped,
 * delivered, batch_filling) says nothing about money and must leave the existing
 * verdict alone, or an admin marking a parcel shipped would silently confirm a
 * payment nobody checked.
 *
 * An explicit `paymentStatus` in the request always wins: it lets an admin
 * reject a bad proof without touching fulfilment at all.
 */
function paymentVerdictFor(
  requested: string | undefined,
  nextStatus: string,
  current: string,
): PaymentStatus {
  if (requested) return requested as PaymentStatus;
  if (nextStatus === 'payment_confirmed') return 'confirmed';
  // A cancellation is a FULFILMENT fact and must not overwrite a PAYMENT one.
  // This used to return 'not_due' unconditionally, which is the same conflation
  // lib/payment-status.ts exists to end: a cancelled order the customer paid
  // into is still paid into, and reading it as "nothing due" forgets money we
  // are holding and a refund we owe — on exactly the orders a refund report
  // exists to find. derivePaymentStatus was corrected for this; the live write
  // path was not, so it kept minting the rows that migration had to repair.
  //
  // Only 'pending' — money owed with no evidence of any — genuinely becomes
  // "nothing due" when an order is called off. A submitted proof still needs
  // someone to look at it before we can say whether a refund is owed.
  if (nextStatus === 'cancelled') return current === 'pending' ? 'not_due' : current as PaymentStatus;
  return current as PaymentStatus;
}

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = schema.parse(await req.json());
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw new ApiError(404, 'Order not found.');

  const paymentStatus = paymentVerdictFor(b.paymentStatus, b.status, order.paymentStatus);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(orders).set({
      status: b.status as never,
      paymentStatus,
      trackingNo: b.trackingNo ?? order.trackingNo,
      // Weekly-report fulfilment fields — only overwrite when provided.
      courier: b.courier ?? order.courier,
      packedBy: b.packedBy ?? order.packedBy,
      paymentMethod: b.paymentMethod ?? order.paymentMethod,
      updatedAt: new Date(),
    }).where(eq(orders.id, id)).returning();
    await tx.insert(orderStatusHistory).values({ orderId: id, status: b.status as never, note: b.note });

    // Cancelling releases everything the order was holding: MOQ campaign kits,
    // MOQ shelf stock, claimed kahati vials and drawn on-hand stock. Guard on
    // the transition into 'cancelled' so re-cancelling never releases twice.
    if (order.status !== 'cancelled' && b.status === 'cancelled') {
      // Group-buy kits go back to the campaign so committed reflects only live
      // commitments; clamp at 0.
      const campaignLines = await tx.select().from(orderItems)
        .where(and(eq(orderItems.orderId, id), eq(orderItems.kind, 'moq_campaign')));
      for (const line of campaignLines) {
        if (line.moqCampaignId) {
          await tx.update(moqCampaigns)
            .set({ committed: sql`GREATEST(${moqCampaigns.committed} - ${line.qty}, 0)` })
            .where(eq(moqCampaigns.id, line.moqCampaignId));
        }
      }

      // MOQ commitments come back off the counter. Skipping this leaves the
      // target reading closer than it is, and a buy goes to the supplier on the
      // strength of orders that were refunded — nothing errors, the number is
      // just wrong in the expensive direction. Updated by id without an
      // isActive filter: an archived product's counter was still moved.
      //
      // Guarded on the cycle the line joined. Once a round is closed its units
      // were ordered from the supplier, and a refund against that placed order
      // must not be taken off the round now filling — those units belong to the
      // people who committed them, and erasing them stalls a buy that was ready.
      // So a line from a closed round is left alone; only the live round moves.
      //
      // GREATEST(...,0) still guards the live round, because a counter is a
      // running figure rather than a ledger and must never read negative.
      const moqLines = await tx.select().from(orderItems)
        .where(and(eq(orderItems.orderId, id), eq(orderItems.kind, 'moq_product')));
      for (const line of moqLines) {
        if (line.moqProductId) {
          await tx.update(moqProducts)
            .set({ committed: sql`GREATEST(${moqProducts.committed} - ${line.qty}, 0)` })
            .where(and(
              eq(moqProducts.id, line.moqProductId),
              // A legacy line carries no cycle number; it belongs to whatever is
              // running now, which is the only round it could have joined.
              line.moqCycleNo == null
                ? sql`true`
                : eq(moqProducts.cycleNo, line.moqCycleNo),
            ));
        }
      }

      // Kahati vials go back to the counter — a cancelled commitment must not
      // count toward the minimum or hold a slot others could claim. Only a
      // counter still SELLING is decremented: a terminal one keeps its
      // historical count of the batch that was (or wasn't) ordered. Clamped at 0.
      //
      // Both selling stages, not just 'open'. A Pasalo counter is live and is
      // being judged against the same minimum, so a cancellation during the
      // stage that did not release its vials would leave the batch counting
      // vials nobody is paying for — and a Pasalo can be RESCUED by a phantom
      // vial, which is worse than a Kahati being: it goes straight to the
      // supplier on the strength of it.
      const kahatiLines = await tx.select().from(orderItems)
        .where(and(eq(orderItems.orderId, id), eq(orderItems.kind, 'group_buy')));
      for (const line of kahatiLines) {
        if (line.groupBuyId) {
          await tx.update(groupBuys)
            .set({ claimedSlots: sql`GREATEST(${groupBuys.claimedSlots} - ${line.qty}, 0)` })
            .where(and(
              eq(groupBuys.id, line.groupBuyId),
              inArray(groupBuys.status, [...JOINABLE_KAHATI_STATUSES]),
            ));
        }
      }

      // On-hand vials return to stock, mirroring the restock the kahati sweep
      // does (lib/kahati-server.ts releaseKahatiOrders). The unit lives in the
      // spec snapshot, so vialsForOrderLine reads it back to size the return.
      const onHandLines = await tx.select().from(orderItems)
        .where(and(eq(orderItems.orderId, id), eq(orderItems.kind, 'product')));
      for (const line of onHandLines) {
        if (line.productId) {
          const vials = vialsForOrderLine(line.specSnapshot, line.qty);
          await tx.update(products).set({
            stock: sql`${products.stock} + ${vials}`,
            soldCount: sql`GREATEST(${products.soldCount} - ${vials}, 0)`,
          }).where(eq(products.id, line.productId));
        }
      }
    }
    return row;
  });

  // Only when it actually moved. A fulfilment-only change logging a payment
  // event would make the payment history unreadable.
  if (paymentStatus !== order.paymentStatus) {
    checkoutLog('payment_status_changed', {
      orderId: id, orderNo: order.orderNo, buyType: order.buyType,
      previousPaymentStatus: order.paymentStatus, paymentStatus,
      status: b.status, totalPhp: Number(order.totalPhp),
    });
  }

  const [customer] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, order.userId));
  if (customer) {
    await sendEmail({
      to: customer.email,
      ...orderStatusEmail({ name: customer.name, orderNo: order.orderNo, status: b.status, trackingNo: updated.trackingNo }),
      kind: `status_${b.status}`,
    });
    // PostHog fires the customer-facing email off this event. It is addressed to
    // the customer, not the admin who made the change.
    await captureEvent({
      event: orderStatusEvent(b.status),
      distinctId: order.userId,
      email: customer.email,
      name: customer.name,
      properties: {
        orderId: order.id, orderNo: order.orderNo, status: b.status,
        statusLabel: STATUS_LABEL[b.status] ?? b.status,
        previousStatus: order.status,
        trackingNo: updated.trackingNo, courier: updated.courier,
        totalPhp: Number(updated.totalPhp), downpaymentPhp: Number(updated.downpaymentPhp),
        buyType: updated.buyType, note: b.note ?? null,
      },
    });
  }
  return ok(updated);
});
