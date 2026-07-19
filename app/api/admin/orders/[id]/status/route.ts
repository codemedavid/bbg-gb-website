import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, orderStatusHistory, moqCampaigns, users } from '@/lib/db';
import { ORDER_STATUS_FLOW } from '@/lib/db/schema';
import { sendEmail, orderStatusEmail } from '@/lib/email';
import { captureEvent, orderStatusEvent } from '@/lib/posthog';
import { STATUS_LABEL } from '@/lib/order-status';

const schema = z.object({
  status: z.enum([...ORDER_STATUS_FLOW, 'cancelled'] as [string, ...string[]]),
  trackingNo: z.string().max(80).optional(),
  note: z.string().max(500).optional(),
  // Weekly-report fulfilment fields (admin-editable, optional).
  courier: z.string().max(40).optional(),
  packedBy: z.string().max(60).optional(),
  paymentMethod: z.string().max(40).optional(),
});

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = schema.parse(await req.json());
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw new ApiError(404, 'Order not found.');

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(orders).set({
      status: b.status as never,
      trackingNo: b.trackingNo ?? order.trackingNo,
      // Weekly-report fulfilment fields — only overwrite when provided.
      courier: b.courier ?? order.courier,
      packedBy: b.packedBy ?? order.packedBy,
      paymentMethod: b.paymentMethod ?? order.paymentMethod,
      updatedAt: new Date(),
    }).where(eq(orders.id, id)).returning();
    await tx.insert(orderStatusHistory).values({ orderId: id, status: b.status as never, note: b.note });

    // Releasing a group-buy order returns its kits to the campaign so committed
    // reflects only live commitments. Guard on the transition into 'cancelled'
    // so re-cancelling never double-decrements; clamp at 0.
    if (order.status !== 'cancelled' && b.status === 'cancelled') {
      const lines = await tx.select().from(orderItems)
        .where(and(eq(orderItems.orderId, id), eq(orderItems.kind, 'moq_campaign')));
      for (const line of lines) {
        if (line.moqCampaignId) {
          await tx.update(moqCampaigns)
            .set({ committed: sql`GREATEST(${moqCampaigns.committed} - ${line.qty}, 0)` })
            .where(eq(moqCampaigns.id, line.moqCampaignId));
        }
      }
    }
    return row;
  });

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
