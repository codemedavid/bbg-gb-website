import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, orderStatusHistory, moqCampaigns, users } from '@/lib/db';
import { ORDER_STATUS_FLOW } from '@/lib/db/schema';
import { sendEmail, orderStatusEmail } from '@/lib/email';

const schema = z.object({
  status: z.enum([...ORDER_STATUS_FLOW, 'cancelled'] as [string, ...string[]]),
  trackingNo: z.string().max(80).optional(),
  note: z.string().max(500).optional(),
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
  }
  return ok(updated);
});
