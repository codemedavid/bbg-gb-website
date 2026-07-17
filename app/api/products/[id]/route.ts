import { eq } from 'drizzle-orm';
import { getDb, products, categories, coaFiles } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const [row] = await db.select({
    id: products.id, code: products.code, name: products.name, spec: products.spec,
    pricePhp: products.pricePhp, priceUsd: products.priceUsd, categoryId: products.categoryId,
    categorySlug: categories.slug, categoryName: categories.name,
    isOnHand: products.isOnHand, onHandKitPhp: products.onHandKitPhp, onHandPiecePhp: products.onHandPiecePhp,
    stock: products.stock, arrivalGroup: products.arrivalGroup, description: products.description,
    imageEmoji: products.imageEmoji, soldCount: products.soldCount,
  }).from(products).leftJoin(categories, eq(products.categoryId, categories.id)).where(eq(products.id, id));
  if (!row) throw new ApiError(404, 'Product not found.');
  const coas = await db.select().from(coaFiles).where(eq(coaFiles.productId, row.id));
  return ok({ ...row, coaFiles: coas });
});
