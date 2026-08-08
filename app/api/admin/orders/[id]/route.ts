import { asc, eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, orderPaymentProofs, orderStatusHistory, users } from '@/lib/db';
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
