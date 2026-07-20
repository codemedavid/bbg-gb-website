import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqProducts, orderItems } from '@/lib/db';
import { parseMoqProductForm, numToStr } from '@/lib/admin-schemas';
import { serializeMoqProduct } from '@/lib/moq-products';
import { validateAndStoreImage } from '@/lib/uploads';
import { BUCKETS } from '@/lib/env';

const MONEY = ['pricePhp', 'priceUsd', 'packingFeePhp'];

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const form = await req.formData();
  const b = parseMoqProductForm(form, true);

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) patch[k] = MONEY.includes(k) ? numToStr(v as number) : v;

  // A new image replaces the old key; omitting the part leaves the image alone.
  const image = form.get('image');
  if (image instanceof File && image.size > 0) {
    patch.imageKey = await validateAndStoreImage(image, BUCKETS.moq);
  }

  if (!Object.keys(patch).length) throw new ApiError(400, 'No fields to update.');

  const db = await getDb();
  const [row] = await db.update(moqProducts).set(patch).where(eq(moqProducts.id, id)).returning();
  if (!row) throw new ApiError(404, 'MOQ product not found.');
  return ok(await serializeMoqProduct(row));
});

// Delete really deletes — but only while nothing depends on the row. Once an
// order has referenced the product, its line items must keep pointing at a real
// row, so the product is archived instead. Either way it leaves the shelf; the
// difference is only whether order history stays intact.
export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();

  const [existing] = await db.select().from(moqProducts).where(eq(moqProducts.id, id));
  if (!existing) throw new ApiError(404, 'MOQ product not found.');

  const [referenced] = await db.select({ id: orderItems.id }).from(orderItems)
    .where(eq(orderItems.moqProductId, id)).limit(1);

  if (referenced) {
    await db.update(moqProducts).set({ isActive: false }).where(eq(moqProducts.id, id));
    return ok({ deleted: false, archived: true });
  }

  await db.delete(moqProducts).where(eq(moqProducts.id, id));
  return ok({ deleted: true, archived: false });
});
