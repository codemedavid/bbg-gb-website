import { Router } from 'express';
import { and, eq, ilike, or, desc } from 'drizzle-orm';
import { db, products, categories, coaFiles } from '../db/index.js';
import { asyncHandler, ok, ApiError } from '../lib/http.js';

export const productsRouter = Router();

// GET /api/categories
productsRouter.get('/categories', asyncHandler(async (_req, res) => {
  const rows = await db.select().from(categories).orderBy(categories.sortOrder);
  ok(res, rows);
}));

// GET /api/products?category=slug&q=text&onHand=true
productsRouter.get('/products', asyncHandler(async (req, res) => {
  const { category, q, onHand } = req.query as Record<string, string | undefined>;
  const filters = [eq(products.isActive, true)];
  if (category && category !== 'All' && category !== 'all') {
    const [cat] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, category.toLowerCase()));
    if (cat) filters.push(eq(products.categoryId, cat.id));
  }
  if (onHand === 'true') filters.push(eq(products.isOnHand, true));
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    filters.push(or(ilike(products.name, like), ilike(products.spec, like))!);
  }
  const rows = await db.select({
    id: products.id, code: products.code, name: products.name, spec: products.spec,
    pricePhp: products.pricePhp, priceUsd: products.priceUsd, categoryId: products.categoryId,
    categorySlug: categories.slug, categoryName: categories.name,
    isOnHand: products.isOnHand, onHandKitPhp: products.onHandKitPhp, onHandPiecePhp: products.onHandPiecePhp,
    stock: products.stock, arrivalGroup: products.arrivalGroup, description: products.description,
    imageEmoji: products.imageEmoji, soldCount: products.soldCount,
  }).from(products).leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(...filters)).orderBy(desc(products.soldCount));
  ok(res, rows);
}));

// GET /api/products/:id
productsRouter.get('/products/:id', asyncHandler(async (req, res) => {
  const [row] = await db.select({
    id: products.id, code: products.code, name: products.name, spec: products.spec,
    pricePhp: products.pricePhp, priceUsd: products.priceUsd, categoryId: products.categoryId,
    categorySlug: categories.slug, categoryName: categories.name,
    isOnHand: products.isOnHand, onHandKitPhp: products.onHandKitPhp, onHandPiecePhp: products.onHandPiecePhp,
    stock: products.stock, arrivalGroup: products.arrivalGroup, description: products.description,
    imageEmoji: products.imageEmoji, soldCount: products.soldCount,
  }).from(products).leftJoin(categories, eq(products.categoryId, categories.id)).where(eq(products.id, req.params.id));
  if (!row) throw new ApiError(404, 'Product not found.');
  const coas = await db.select().from(coaFiles).where(eq(coaFiles.productId, row.id));
  ok(res, { ...row, coaFiles: coas });
}));
