import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, products } from '@/lib/db';
import { productSchema, numToStr } from '@/lib/admin-schemas';

const MONEY = ['pricePhp', 'priceUsd', 'onHandKitPhp', 'onHandPiecePhp'];

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = productSchema.partial().parse(await req.json());
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) patch[k] = MONEY.includes(k) ? numToStr(v as number) : v;
  if (!Object.keys(patch).length) throw new ApiError(400, 'No fields to update.');
  const db = await getDb();
  const [row] = await db.update(products).set(patch).where(eq(products.id, id)).returning();
  if (!row) throw new ApiError(404, 'Product not found.');
  return ok(row);
});

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();
  const [row] = await db.update(products).set({ isActive: false }).where(eq(products.id, id)).returning();
  if (!row) throw new ApiError(404, 'Product not found.');
  return ok({ archived: true });
});
