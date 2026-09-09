import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, coaFiles, products } from '@/lib/db';
import { coaFileSchema } from '@/lib/admin-schemas';
import { validateAndStoreImage } from '@/lib/uploads';
import { serializeCoaFile } from '@/lib/coa';
import { BUCKETS } from '@/lib/env';

// Parses the multipart text fields. The certificate itself is handled separately,
// by lib/uploads, which is what validates its type and size.
export function parseCoaForm(form: FormData) {
  const label = form.get('label');
  const batch = form.get('batch');
  const productId = form.get('productId');
  return coaFileSchema.parse({
    // An empty label is not a label — it means "name it after the file".
    label: label == null || String(label).trim() === '' ? undefined : String(label).trim(),
    batch: batch == null ? undefined : String(batch).trim() || null,
    productId: productId == null || String(productId).trim() === '' ? undefined : String(productId).trim(),
  });
}

// Looked up rather than left to the foreign key. A raw FK violation surfaces as a
// 500 "Something went wrong", which tells an admin nothing about the product that
// was deleted out from under the form they had open. Checked BEFORE the upload so
// a rejected submission cannot leave an orphaned file in the bucket.
async function requireProductName(id: string): Promise<string> {
  const db = await getDb();
  const [product] = await db.select({ name: products.name }).from(products).where(eq(products.id, id));
  if (!product) throw new ApiError(404, 'Product not found.');
  return product.name;
}

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const form = await req.formData();
  const b = parseCoaForm(form);
  const productName = b.productId ? await requireProductName(b.productId) : null;

  // The document IS the COA, so there is nothing to create without one — unlike
  // an edit, which can keep the stored file.
  const file = form.get('file');
  const storageKey = await validateAndStoreImage(file, BUCKETS.coa);

  // Named after the uploaded file when the admin typed nothing, so a certificate
  // is never listed as a blank row. Trimmed to the column, which is the length
  // the admin form also caps at.
  const fileName = (b.label ?? (file instanceof File ? file.name : 'COA')).slice(0, 200);

  const db = await getDb();
  const [row] = await db.insert(coaFiles).values({
    productId: b.productId ?? null,
    batch: b.batch ?? null,
    fileName,
    storageKey,
  }).returning();
  return ok(serializeCoaFile(row, productName), 201);
});
