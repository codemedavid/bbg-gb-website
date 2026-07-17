import { eq } from 'drizzle-orm';
import { getDb, orders, orderItems, orderStatusHistory } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw new ApiError(404, 'Order not found.');
  if (order.userId !== session.sub && session.role !== 'admin') throw new ApiError(403, 'Not your order.');
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  const history = await db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(orderStatusHistory.createdAt);
  const proofUrl = order.paymentProofKey ? await signedUrl(BUCKETS.proofs, order.paymentProofKey) : null;
  return ok({ order, items, history, proofUrl });
});
