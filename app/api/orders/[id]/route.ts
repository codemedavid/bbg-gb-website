import { asc, eq } from 'drizzle-orm';
import { getDb, orders, orderItems, orderPaymentProofs, orderStatusHistory, users, settlements } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';

// One order, whole. The customer-facing details page renders exactly this
// response, so anything missing here is a blank field on that page.
//
// The customer block is joined from the user record because the email lives
// there, not on the order. Shipping is deliberately NOT taken from that record:
// the order's own shipName/shipPhone/shipAddress snapshot is where the parcel
// was actually sent, and an address edited afterwards must not rewrite the
// history of a parcel already packed.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const db = await getDb();

  const [row] = await db
    .select({ order: orders, settlementStatus: settlements.status, customerName: users.name, customerEmail: users.email })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .leftJoin(settlements, eq(settlements.id, orders.settlementId))
    .where(eq(orders.id, id));

  if (!row) throw new ApiError(404, 'Order not found.');
  const { order, settlementStatus, customerName, customerEmail } = row;
  if (order.userId !== session.sub && session.role !== 'admin') throw new ApiError(403, 'Not your order.');

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  const history = await db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(orderStatusHistory.createdAt);
  // Proofs are private, so the storage key never reaches the browser — only a
  // signed, fetchable URL.
  const proofUrl = order.paymentProofKey ? await signedUrl(BUCKETS.proofs, order.paymentProofKey) : null;
  // Every proof the order carries. The customer needs the whole list to decide
  // whether to add another — someone who paid in two transfers and can only see
  // one has no way to tell whether the second upload landed.
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

  return ok({
    order: { ...order, settlementStatus },
    customer: { name: customerName, email: customerEmail, phone: order.shipPhone },
    items,
    history,
    proofUrl,
    proofs,
  });
});
