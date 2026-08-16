import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, orderItems, orderPaymentProofs, orderStatusHistory, users } from '@/lib/db';
import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { applyOrderItemEdit } from '@/lib/order-edit-server';
import { orderUpdatedEmail, sendEmail } from '@/lib/email';

const editableItemSchema = z.object({
  id: z.string().uuid().optional(),
  // Required for an existing line and for a free-text adjustment; ignored when
  // productId names a catalog item, because that line is snapshotted from the
  // product row rather than from the request.
  nameSnapshot: z.string().trim().max(200).default(''),
  specSnapshot: z.string().trim().max(120).nullable().optional(),
  qty: z.number().int().positive().max(9999),
  unitPricePhp: z.number().nonnegative().max(10_000_000).default(0),
  /** New lines only: add a real catalog product, which draws stock. */
  productId: z.string().uuid().nullable().optional(),
  unit: z.enum(['piece', 'kit']).optional(),
})
  // A line that is neither an existing row nor a catalog product is a manual
  // adjustment, and one with no name is an unlabelled charge on someone's
  // receipt. Caught here rather than reaching the customer's revised receipt.
  .refine((item) => item.id || item.productId || item.nameSnapshot.length > 0, {
    message: 'A manual line needs a name.',
    path: ['nameSnapshot'],
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

    const edited = await applyOrderItemEdit(tx, id, body.items);

    await tx.insert(orderStatusHistory).values({
      orderId: id,
      status: order.status,
      note: 'Admin edited order items and totals',
    });
    return edited;
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
