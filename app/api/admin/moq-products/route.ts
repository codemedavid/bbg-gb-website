import { asc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqProducts } from '@/lib/db';
import { parseMoqProductForm, numToStr } from '@/lib/admin-schemas';
import { serializeMoqProduct } from '@/lib/moq-products';
import { validateAndStoreImage } from '@/lib/uploads';
import { BUCKETS } from '@/lib/env';

// The MOQ shelf is deliberately scoped to moq_products: this route never reads
// or writes the main catalog, so an admin managing the MOQ page cannot reach
// shop inventory through it.
export const GET = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  // Archived rows are included — the admin manages the whole shelf, and only
  // customers see the filtered view.
  const rows = await db.select().from(moqProducts)
    .orderBy(asc(moqProducts.sortOrder), asc(moqProducts.createdAt));
  return ok(await Promise.all(rows.map(serializeMoqProduct)));
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const form = await req.formData();
  const b = parseMoqProductForm(form, false);

  const image = form.get('image');
  const imageKey = image instanceof File && image.size > 0
    ? await validateAndStoreImage(image, BUCKETS.moq)
    : null;

  const db = await getDb();
  const [row] = await db.insert(moqProducts).values({
    name: b.name, spec: b.spec ?? '', description: b.description ?? null,
    imageKey, imageEmoji: b.imageEmoji ?? '📦',
    pricePhp: String(b.pricePhp), priceUsd: numToStr(b.priceUsd),
    stock: b.stock ?? 0, minOrderQty: b.minOrderQty ?? 1,
    packingFeePhp: numToStr(b.packingFeePhp),
    arrivalGroup: b.arrivalGroup ?? 'white_powder',
    isActive: b.isActive ?? true, sortOrder: b.sortOrder ?? 0,
  }).returning();

  return ok(await serializeMoqProduct(row), 201);
});
