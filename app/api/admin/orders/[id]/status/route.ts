import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderStatusHistory, users } from '@/lib/db';
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

  const [updated] = await db.update(orders).set({
    status: b.status as never,
    trackingNo: b.trackingNo ?? order.trackingNo,
    updatedAt: new Date(),
  }).where(eq(orders.id, id)).returning();
  await db.insert(orderStatusHistory).values({ orderId: id, status: b.status as never, note: b.note });

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
