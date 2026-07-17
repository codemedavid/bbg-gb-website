import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, orderStatusHistory, users } from '@/lib/db';
import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw new ApiError(404, 'Order not found.');
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  const history = await db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(orderStatusHistory.createdAt);
  const [customer] = await db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, order.userId));
  const proofUrl = order.paymentProofKey ? await signedUrl(BUCKETS.proofs, order.paymentProofKey) : null;
  return ok({ order, items, history, customer, proofUrl });
});
