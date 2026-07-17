import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { getDb, products, categories } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';

const cols = {
  id: products.id, code: products.code, name: products.name, spec: products.spec,
  pricePhp: products.pricePhp, priceUsd: products.priceUsd, categoryId: products.categoryId,
  categorySlug: categories.slug, categoryName: categories.name,
  isOnHand: products.isOnHand, onHandKitPhp: products.onHandKitPhp, onHandPiecePhp: products.onHandPiecePhp,
  stock: products.stock, arrivalGroup: products.arrivalGroup, description: products.description,
  imageEmoji: products.imageEmoji, soldCount: products.soldCount,
};

export const GET = handler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  const q = searchParams.get('q');
  const onHand = searchParams.get('onHand');
  const db = await getDb();

  const filters = [eq(products.isActive, true)];
  if (category && category.toLowerCase() !== 'all') {
    const [cat] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, category.toLowerCase()));
    if (cat) filters.push(eq(products.categoryId, cat.id));
  }
  if (onHand === 'true') filters.push(eq(products.isOnHand, true));
  if (q?.trim()) {
    const like = `%${q.trim()}%`;
    filters.push(or(ilike(products.name, like), ilike(products.spec, like))!);
  }
  const rows = await db.select(cols).from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(...filters)).orderBy(desc(products.soldCount));
  return ok(rows);
});
