import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, paymentMethods } from '@/lib/db';
import { validateAndStoreImage } from '@/lib/uploads';
import { serializePaymentMethod } from '@/lib/payment-methods';
import { BUCKETS } from '@/lib/env';
import { parseMethodForm } from '../route';

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const form = await req.formData();
  const b = parseMethodForm(form);
  const db = await getDb();

  // Only replace the QR when a new file is provided; otherwise keep the stored one.
  const qr = form.get('qr');
  const newQrKey = qr instanceof File && qr.size > 0 ? await validateAndStoreImage(qr, BUCKETS.qr) : undefined;

  const [row] = await db.update(paymentMethods).set({
    label: b.label, accountName: b.accountName, accountNumber: b.accountNumber,
    isActive: b.isActive ?? true, sortOrder: b.sortOrder ?? 0,
    ...(newQrKey !== undefined ? { qrKey: newQrKey } : {}),
  }).where(eq(paymentMethods.id, id)).returning();
  if (!row) throw new ApiError(404, 'Payment method not found.');
  return ok(await serializePaymentMethod(row));
});

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();
  const [row] = await db.delete(paymentMethods).where(eq(paymentMethods.id, id)).returning();
  if (!row) throw new ApiError(404, 'Payment method not found.');
  return ok({ id });
});
