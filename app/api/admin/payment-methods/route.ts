import { asc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, paymentMethods } from '@/lib/db';
import { paymentMethodSchema } from '@/lib/admin-schemas';
import { validateAndStoreImage } from '@/lib/uploads';
import { serializePaymentMethod } from '@/lib/payment-methods';
import { BUCKETS } from '@/lib/env';
import { DEFAULT_PAYMENT_PURPOSE } from '@/lib/payment-purpose';

// Parses the multipart text fields (QR file is handled separately).
export function parseMethodForm(form: FormData) {
  const isActive = form.get('isActive');
  const sortOrder = form.get('sortOrder');
  const purpose = form.get('purpose');
  const instructions = form.get('instructions');
  return paymentMethodSchema.parse({
    label: form.get('label'),
    accountName: form.get('accountName'),
    accountNumber: form.get('accountNumber'),
    // Absent means 'full', which is what every method was before the hatian
    // downpayment QR existed — an older client that does not send the field
    // must not be able to create a downpayment method by accident.
    purpose: purpose == null || purpose === '' ? undefined : String(purpose),
    // An empty string is a deliberate clear, distinct from an absent field.
    instructions: instructions == null ? undefined : String(instructions).trim() || null,
    isActive: isActive == null ? undefined : isActive === 'true',
    sortOrder: sortOrder == null || sortOrder === '' ? undefined : Number(sortOrder),
  });
}

export const GET = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  const rows = await db.select().from(paymentMethods)
    .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.createdAt));
  return ok(await Promise.all(rows.map(serializePaymentMethod)));
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const form = await req.formData();
  const b = parseMethodForm(form);
  const qr = form.get('qr');
  const qrKey = qr instanceof File && qr.size > 0 ? await validateAndStoreImage(qr, BUCKETS.qr) : null;
  const db = await getDb();
  const [row] = await db.insert(paymentMethods).values({
    label: b.label, accountName: b.accountName, accountNumber: b.accountNumber,
    qrKey, purpose: b.purpose ?? DEFAULT_PAYMENT_PURPOSE, instructions: b.instructions ?? null,
    isActive: b.isActive ?? true, sortOrder: b.sortOrder ?? 0,
  }).returning();
  return ok(await serializePaymentMethod(row), 201);
});
