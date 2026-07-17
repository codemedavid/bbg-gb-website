import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  db, products, categories, groupBuys, orders, orderItems, orderStatusHistory, users, coaFiles,
} from '../db/index.js';
import { asyncHandler, ok, ApiError } from '../lib/http.js';
import { requireAdmin } from '../middleware/auth.js';
import { dashboardStats } from '../services/analytics.js';
import { ORDER_STATUS_FLOW } from '../db/schema.js';
import { sendEmail, orderStatusEmail } from '../services/email.js';
import { putFile, signedUrl } from '../lib/storage.js';
import { BUCKETS } from '../lib/env.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ---------- Analytics ----------
adminRouter.get('/stats', asyncHandler(async (_req, res) => ok(res, await dashboardStats())));

// ---------- Products ----------
const productSchema = z.object({
  code: z.string().max(40).optional(),
  name: z.string().min(2).max(160),
  spec: z.string().min(1).max(120),
  categoryId: z.string().uuid().nullable().optional(),
  pricePhp: z.number().nonnegative(),
  priceUsd: z.number().nonnegative().nullable().optional(),
  isOnHand: z.boolean().optional(),
  onHandKitPhp: z.number().nonnegative().nullable().optional(),
  onHandPiecePhp: z.number().nonnegative().nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
  arrivalGroup: z.enum(['white_powder', 'salt_liquid']).optional(),
  description: z.string().max(2000).nullable().optional(),
  imageEmoji: z.string().max(8).optional(),
  isActive: z.boolean().optional(),
});
const numToStr = (n: number | null | undefined) => (n == null ? null : String(n));

adminRouter.get('/products', asyncHandler(async (_req, res) => {
  const rows = await db.select().from(products).orderBy(desc(products.createdAt));
  ok(res, rows);
}));

adminRouter.post('/products', asyncHandler(async (req, res) => {
  const b = productSchema.parse(req.body);
  const [row] = await db.insert(products).values({
    code: b.code, name: b.name, spec: b.spec, categoryId: b.categoryId ?? null,
    pricePhp: String(b.pricePhp), priceUsd: numToStr(b.priceUsd),
    isOnHand: b.isOnHand ?? false, onHandKitPhp: numToStr(b.onHandKitPhp), onHandPiecePhp: numToStr(b.onHandPiecePhp),
    stock: b.stock ?? 0, arrivalGroup: b.arrivalGroup ?? 'white_powder',
    description: b.description ?? null, imageEmoji: b.imageEmoji ?? '💧', isActive: b.isActive ?? true,
  }).returning();
  ok(res, row, 201);
}));

adminRouter.patch('/products/:id', asyncHandler(async (req, res) => {
  const b = productSchema.partial().parse(req.body);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (['pricePhp', 'priceUsd', 'onHandKitPhp', 'onHandPiecePhp'].includes(k)) patch[k] = numToStr(v as number);
    else patch[k] = v;
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'No fields to update.');
  const [row] = await db.update(products).set(patch).where(eq(products.id, req.params.id)).returning();
  if (!row) throw new ApiError(404, 'Product not found.');
  ok(res, row);
}));

adminRouter.delete('/products/:id', asyncHandler(async (req, res) => {
  const [row] = await db.update(products).set({ isActive: false }).where(eq(products.id, req.params.id)).returning();
  if (!row) throw new ApiError(404, 'Product not found.');
  ok(res, { archived: true });
}));

// COA upload for a product
adminRouter.post('/products/:id/coa', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'COA file is required.');
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, req.params.id));
  if (!p) throw new ApiError(404, 'Product not found.');
  const key = `${req.params.id}/${randomUUID()}.pdf`;
  await putFile(BUCKETS.coa, key, req.file.buffer, req.file.mimetype || 'application/pdf');
  const [row] = await db.insert(coaFiles).values({
    productId: req.params.id, batch: req.body.batch || null, fileName: req.file.originalname, storageKey: key,
  }).returning();
  ok(res, row, 201);
}));

// ---------- Group buys (with editable prices) ----------
const groupBuySchema = z.object({
  name: z.string().min(2).max(160),
  pricePerKitPhp: z.number().nonnegative(),
  totalSlots: z.number().int().positive(),
  claimedSlots: z.number().int().nonnegative().optional(),
  minVials: z.number().int().positive().optional(),
  repackFeePhp: z.number().nonnegative().optional(),
  status: z.enum(['open', 'closed', 'shipped', 'completed']).optional(),
  closesAt: z.string().datetime().nullable().optional(),
  arrivalGroup: z.enum(['white_powder', 'salt_liquid']).optional(),
  description: z.string().max(2000).nullable().optional(),
});

adminRouter.get('/groupbuys', asyncHandler(async (_req, res) => {
  ok(res, await db.select().from(groupBuys).orderBy(desc(groupBuys.createdAt)));
}));

adminRouter.post('/groupbuys', asyncHandler(async (req, res) => {
  const b = groupBuySchema.parse(req.body);
  const [row] = await db.insert(groupBuys).values({
    name: b.name, pricePerKitPhp: String(b.pricePerKitPhp), totalSlots: b.totalSlots,
    claimedSlots: b.claimedSlots ?? 0, minVials: b.minVials ?? 7,
    repackFeePhp: String(b.repackFeePhp ?? 150), status: b.status ?? 'open',
    closesAt: b.closesAt ? new Date(b.closesAt) : null, arrivalGroup: b.arrivalGroup ?? 'white_powder',
    description: b.description ?? null,
  }).returning();
  ok(res, row, 201);
}));

adminRouter.patch('/groupbuys/:id', asyncHandler(async (req, res) => {
  const b = groupBuySchema.partial().parse(req.body);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'pricePerKitPhp' || k === 'repackFeePhp') patch[k] = String(v);
    else if (k === 'closesAt') patch[k] = v ? new Date(v as string) : null;
    else patch[k] = v;
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'No fields to update.');
  const [row] = await db.update(groupBuys).set(patch).where(eq(groupBuys.id, req.params.id)).returning();
  if (!row) throw new ApiError(404, 'Group buy not found.');
  ok(res, row);
}));

adminRouter.delete('/groupbuys/:id', asyncHandler(async (req, res) => {
  await db.delete(groupBuys).where(eq(groupBuys.id, req.params.id));
  ok(res, { deleted: true });
}));

// ---------- Orders ----------
adminRouter.get('/orders', asyncHandler(async (req, res) => {
  const status = (req.query.status as string) || undefined;
  const base = db.select({
    id: orders.id, orderNo: orders.orderNo, status: orders.status, buyType: orders.buyType,
    totalPhp: orders.totalPhp, shipName: orders.shipName, shipPhone: orders.shipPhone,
    trackingNo: orders.trackingNo, createdAt: orders.createdAt, customerEmail: users.email,
  }).from(orders).leftJoin(users, eq(orders.userId, users.id)).orderBy(desc(orders.createdAt));
  const rows = status ? await base.where(eq(orders.status, status as never)) : await base;
  ok(res, rows);
}));

adminRouter.get('/orders/:id', asyncHandler(async (req, res) => {
  const [order] = await db.select().from(orders).where(eq(orders.id, req.params.id));
  if (!order) throw new ApiError(404, 'Order not found.');
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const history = await db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, order.id)).orderBy(orderStatusHistory.createdAt);
  const [customer] = await db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, order.userId));
  const proofUrl = order.paymentProofKey ? await signedUrl(BUCKETS.proofs, order.paymentProofKey) : null;
  ok(res, { order, items, history, customer, proofUrl });
}));

const statusSchema = z.object({
  status: z.enum([...ORDER_STATUS_FLOW, 'cancelled'] as [string, ...string[]]),
  trackingNo: z.string().max(80).optional(),
  note: z.string().max(500).optional(),
});

adminRouter.patch('/orders/:id/status', asyncHandler(async (req, res) => {
  const b = statusSchema.parse(req.body);
  const [order] = await db.select().from(orders).where(eq(orders.id, req.params.id));
  if (!order) throw new ApiError(404, 'Order not found.');
  const [updated] = await db.update(orders).set({
    status: b.status as never,
    trackingNo: b.trackingNo ?? order.trackingNo,
    updatedAt: new Date(),
  }).where(eq(orders.id, order.id)).returning();
  await db.insert(orderStatusHistory).values({ orderId: order.id, status: b.status as never, note: b.note });

  const [customer] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, order.userId));
  if (customer) {
    const email = orderStatusEmail({ name: customer.name, orderNo: order.orderNo, status: b.status, trackingNo: updated.trackingNo });
    await sendEmail({ to: customer.email, ...email, kind: `status_${b.status}` });
  }
  ok(res, updated);
}));

// ---------- Categories (for product form) ----------
adminRouter.get('/categories', asyncHandler(async (_req, res) => {
  ok(res, await db.select().from(categories).orderBy(categories.sortOrder));
}));
