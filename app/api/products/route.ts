import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { getDb, products, categories } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';

const cols = {
  id: products.id, code: products.code, name: products.name, spec: products.spec,
  pricePhp: products.pricePhp, priceUsd: products.priceUsd, categoryId: products.categoryId,
  categorySlug: categories.slug, categoryName: categories.name,
  isOnHand: products.isOnHand, onHandKitPhp: products.onHandKitPhp, onHandPiecePhp: products.onHandPiecePhp,
  onHandTenVialPhp: products.onHandTenVialPhp,
  stock: products.stock, arrivalGroup: products.arrivalGroup, description: products.description,
  imageEmoji: products.imageEmoji, soldCount: products.soldCount,
  // What either board charges for this product. The order calculator quotes the
  // boards, so it needs the same three columns kahatiSeedFor and campaignSeedFor
  // read; without them it can only see the shop price and cannot tell an
  // admin-set group buy rate from the list one.
  gbPricePerKitPhp: products.gbPricePerKitPhp, gbPricePerPiecePhp: products.gbPricePerPiecePhp,
  gbVialsPerKit: products.gbVialsPerKit,
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
