import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, products } from '@/lib/db';
import { productSchema, numToStr } from '@/lib/admin-schemas';
import { syncListingsForProduct } from '@/lib/listing-sync-server';

// Numeric columns Drizzle wants as strings. The group buy prices belong here for
// the same reason the on-hand ones do — a raw number reaches the driver as an
// integer and loses the centavos.
const MONEY = [
  'pricePhp', 'priceUsd', 'onHandKitPhp', 'onHandPiecePhp', 'onHandTenVialPhp',
  'gbPricePerKitPhp', 'gbPricePerPiecePhp',
];

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = productSchema.partial().parse(await req.json());
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) patch[k] = MONEY.includes(k) ? numToStr(v as number) : v;
  if (!Object.keys(patch).length) throw new ApiError(400, 'No fields to update.');
  const db = await getDb();
  // Saving the product and pushing the edit onto the listings it already opened
  // are one operation, in one transaction. The catalog is the authority for what
  // both boards charge, so the two must never be observed disagreeing: a sync
  // that fails takes the product edit down with it rather than leaving the shop
  // quoting a price product management no longer holds.
  //
  // The row is re-read here rather than derived from the request body because
  // the push compares the product BEFORE the edit with the product after it, and
  // a partial PATCH names only the fields it changes — everything the boards
  // derive from the untouched columns has to come from the stored row.
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, id));
    if (!before) throw new ApiError(404, 'Product not found.');
    const [after] = await tx.update(products).set(patch).where(eq(products.id, id)).returning();
    await syncListingsForProduct(tx, before, after);
    return after;
  });
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
