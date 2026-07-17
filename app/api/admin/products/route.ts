import { desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, products } from '@/lib/db';
import { productSchema, numToStr } from '@/lib/admin-schemas';

export const GET = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  return ok(await db.select().from(products).orderBy(desc(products.createdAt)));
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const b = productSchema.parse(await req.json());
  const db = await getDb();
  const [row] = await db.insert(products).values({
    code: b.code, name: b.name, spec: b.spec, categoryId: b.categoryId ?? null,
    pricePhp: String(b.pricePhp), priceUsd: numToStr(b.priceUsd),
    isOnHand: b.isOnHand ?? false, onHandKitPhp: numToStr(b.onHandKitPhp), onHandPiecePhp: numToStr(b.onHandPiecePhp),
    stock: b.stock ?? 0, arrivalGroup: b.arrivalGroup ?? 'white_powder',
    description: b.description ?? null, imageEmoji: b.imageEmoji ?? '💧', isActive: b.isActive ?? true,
  }).returning();
  return ok(row, 201);
});
