import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { getDb, orders, orderItems, orderPaymentProofs, orderStatusHistory, users, settlements } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { applyOrderItemEdit } from '@/lib/order-edit-server';
import { customerEditability, EDIT_BLOCKED_MESSAGE } from '@/lib/order-edit';
import { orderUpdatedEmail, sendEmail } from '@/lib/email';
import { captureEvent } from '@/lib/posthog';

// What the customer may say about one of their own lines: keep it at a new
// quantity, or leave it out to drop it. Deliberately NOT the admin's schema —
// there is no name, no spec and above all no price here, because a surface that
// accepts a price from the browser is a surface that lets a customer set one.
const customerEditSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    qty: z.number().int().positive().max(9999),
  })).max(200),
});

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

// Customer: change the quantities on an order you have not finished paying for,
// or drop a line from it.
//
// Client feedback: "clients can edit yung added items na di pa nababayadan in
// full sa cart nila". Until now only an admin could touch a placed order, so
// every "make it 2 not 3" was a message somebody had to action by hand.
//
// The narrow schema is the security boundary. The customer names a line and a
// quantity; the PRICE is read from the row already in the database, never from
// the request, so this cannot become a way to re-price an order. Ownership and
// timing are checked before anything is written, and the actual rewrite —
// returning slots, guarding increases, re-totalling — is the same code the
// admin edit runs (lib/order-edit-server.ts), so the two cannot drift.
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const body = customerEditSchema.parse(await req.json());
  const db = await getDb();

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ order: orders, settlementStatus: settlements.status })
      .from(orders)
      .leftJoin(settlements, eq(settlements.id, orders.settlementId))
      .where(eq(orders.id, id));
    if (!row) throw new ApiError(404, 'Order not found.');
    // Not-yours reads as not-found: confirming an order exists to someone who
    // cannot see it is an enumeration oracle for order ids.
    if (row.order.userId !== session.sub) throw new ApiError(404, 'Order not found.');

    const reason = customerEditability(row.order, row.settlementStatus);
    if (reason !== 'editable') throw new ApiError(409, EDIT_BLOCKED_MESSAGE[reason]);

    const existing = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));
    const keptIds = new Set(body.items.map((item) => item.id));
    for (const item of body.items) {
      if (!existing.some((line) => line.id === item.id)) {
        throw new ApiError(400, 'An order item does not belong to this order.');
      }
    }
    // An order with no lines is not an edit, it is a cancellation — and
    // cancelling has its own rules (refunds, released slots, a notified admin)
    // that this route does not implement. Refused rather than half-done.
    if (!body.items.length) {
      throw new ApiError(400, 'An order needs at least one item. Message us if you want to cancel it.');
    }

    // Price, name and spec come from the stored row every time.
    const edited = body.items.map((item) => {
      const line = existing.find((l) => l.id === item.id)!;
      return {
        id: line.id,
        nameSnapshot: line.nameSnapshot,
        specSnapshot: line.specSnapshot,
        qty: item.qty,
        unitPricePhp: Number(line.unitPricePhp),
      };
    });

    const applied = await applyOrderItemEdit(tx, id, edited);
    const dropped = existing.filter((line) => !keptIds.has(line.id));
    await tx.insert(orderStatusHistory).values({
      orderId: id,
      status: row.order.status,
      note: dropped.length
        ? `Customer edited their order — removed ${dropped.map((l) => l.nameSnapshot).join(', ')}`
        : 'Customer edited their order quantities',
    });
    return applied;
  });

  // The revised receipt, so the customer has the new figure in writing and the
  // admin verifying their proof is not checking it against a stale total.
  const [customer] = await db.select({ name: users.name, email: users.email })
    .from(users).where(eq(users.id, result.order.userId));
  if (customer) {
    const packingFee = Number(result.order.packingFeePhp ?? 0)
      || Number(result.order.shippingPhp ?? 0) + Number(result.order.repackFeePhp ?? 0);
    const items = result.items.map((item) => ({
      name: item.nameSnapshot, qty: item.qty, unitPrice: Number(item.unitPricePhp),
      lineTotal: Number(item.lineTotalPhp),
    }));
    await sendEmail({
      to: customer.email,
      ...orderUpdatedEmail({
        name: customer.name,
        orderNo: result.order.orderNo,
        subtotal: Number(result.order.subtotalPhp),
        packingFee,
        total: Number(result.order.totalPhp),
        items,
      }),
      kind: 'order_receipt_updated',
    });
    await captureEvent({
      event: 'order_updated',
      distinctId: result.order.userId,
      email: customer.email,
      name: customer.name ?? undefined,
      properties: {
        orderId: result.order.id, orderNo: result.order.orderNo,
        subtotalPhp: Number(result.order.subtotalPhp),
        packingFeePhp: packingFee,
        totalPhp: Number(result.order.totalPhp),
        editedBy: 'customer',
        items,
      },
    });
  }

  return ok(result);
});
