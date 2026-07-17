import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  db, orders, orderItems, orderStatusHistory, products, groupBuys, users,
} from '../db/index.js';
import { asyncHandler, ok, ApiError } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import {
  computeTotals, perVialPrice, validateKahatiCommit, round2, type PriceableItem,
} from '../lib/pricing.js';
import { putFile, signedUrl } from '../lib/storage.js';
import { BUCKETS } from '../lib/env.js';
import { sendEmail, orderPlacedEmail } from '../services/email.js';

export const ordersRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (_req, file, cb) => {
    const okType = /^(image\/(jpe?g|png|webp|heic)|application\/pdf)$/.test(file.mimetype);
    if (!okType) return cb(new ApiError(400, 'Proof must be an image or PDF.'));
    cb(null, true);
  },
});

const itemSchema = z.object({
  kind: z.enum(['product', 'group_buy']),
  refId: z.string().uuid(),
  qty: z.number().int().positive().max(9999),
});
const checkoutSchema = z.object({
  items: z.array(itemSchema).min(1),
  shipName: z.string().min(2).max(120),
  shipPhone: z.string().min(7).max(40),
  shipAddress: z.string().min(5).max(500),
});

async function nextOrderNo(): Promise<string> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(orders);
  return `BBG-${2418 + Number(count)}`;
}

// POST /api/orders  (multipart: proof file + JSON fields)
ordersRouter.post('/', requireAuth, upload.single('proof'), asyncHandler(async (req, res) => {
  const raw = { ...req.body, items: typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items };
  const body = checkoutSchema.parse(raw);
  if (!req.file) throw new ApiError(400, 'Payment proof is required to place an order.');

  // Re-price everything server-side; never trust client prices.
  const priced: (PriceableItem & { nameSnapshot: string; specSnapshot: string; productId?: string; groupBuyId?: string })[] = [];
  for (const it of body.items) {
    if (it.kind === 'product') {
      const [p] = await db.select().from(products).where(and(eq(products.id, it.refId), eq(products.isActive, true)));
      if (!p) throw new ApiError(400, `Product not available: ${it.refId}`);
      priced.push({
        kind: 'product', unitPricePhp: Number(p.pricePhp), qty: it.qty,
        nameSnapshot: `${p.name} ${p.spec}`, specSnapshot: p.spec, productId: p.id,
      });
    } else {
      const [g] = await db.select().from(groupBuys).where(eq(groupBuys.id, it.refId));
      if (!g) throw new ApiError(400, `Group buy not found: ${it.refId}`);
      if (g.status !== 'open') throw new ApiError(400, `Kahati "${g.name}" is already closed.`);
      const check = validateKahatiCommit(it.qty, g.totalSlots - g.claimedSlots, g.minVials);
      if (!check.ok) throw new ApiError(400, check.message!);
      priced.push({
        kind: 'group_buy', unitPricePhp: perVialPrice(Number(g.pricePerKitPhp)), qty: it.qty,
        repackFeePhp: Number(g.repackFeePhp),
        nameSnapshot: `${g.name} — kahati`, specSnapshot: `Kahati · min ${g.minVials} vials`, groupBuyId: g.id,
      });
    }
  }

  const totals = computeTotals(priced);
  const orderNo = await nextOrderNo();

  // Store payment proof (private bucket / local dir)
  const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
  const proofKey = `${orderNo}/${randomUUID()}.${ext}`;
  await putFile(BUCKETS.proofs, proofKey, req.file.buffer, req.file.mimetype);

  const [order] = await db.insert(orders).values({
    orderNo, userId: req.user!.sub, status: 'proof_review', buyType: totals.buyType,
    subtotalPhp: String(totals.subtotal), shippingPhp: String(totals.shipping),
    repackFeePhp: String(totals.repackFee), totalPhp: String(totals.total),
    shipName: body.shipName, shipPhone: body.shipPhone, shipAddress: body.shipAddress,
    paymentProofKey: proofKey,
  }).returning();

  await db.insert(orderItems).values(priced.map((p) => ({
    orderId: order.id, kind: p.kind, productId: p.productId ?? null, groupBuyId: p.groupBuyId ?? null,
    nameSnapshot: p.nameSnapshot, specSnapshot: p.specSnapshot,
    unitPricePhp: String(p.unitPricePhp), qty: p.qty, lineTotalPhp: String(round2(p.unitPricePhp * p.qty)),
  })));
  await db.insert(orderStatusHistory).values({ orderId: order.id, status: 'proof_review', note: 'Order placed' });

  // Update inventory counters + kahati slots
  for (const p of priced) {
    if (p.kind === 'product' && p.productId) {
      await db.update(products).set({
        soldCount: sql`${products.soldCount} + ${p.qty}`,
        stock: sql`GREATEST(${products.stock} - ${p.qty}, 0)`,
      }).where(eq(products.id, p.productId));
    } else if (p.kind === 'group_buy' && p.groupBuyId) {
      await db.update(groupBuys).set({ claimedSlots: sql`${groupBuys.claimedSlots} + ${p.qty}` })
        .where(eq(groupBuys.id, p.groupBuyId));
    }
  }

  const email = orderPlacedEmail({ name: body.shipName, orderNo, total: totals.total });
  await sendEmail({ to: req.user!.email, ...email, kind: 'order_placed' });

  ok(res, { order, orderNo, totals }, 201);
}));

async function loadOrderDetail(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const history = await db.select().from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, orderId)).orderBy(orderStatusHistory.createdAt);
  return { order, items, history };
}

// GET /api/orders  (current user's orders, newest first)
ordersRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const rows = await db.select().from(orders).where(eq(orders.userId, req.user!.sub)).orderBy(desc(orders.createdAt));
  const withItems = await Promise.all(rows.map(async (o) => ({
    ...o, items: await db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
  })));
  ok(res, withItems);
}));

// GET /api/orders/:id  (owner or admin)
ordersRouter.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const detail = await loadOrderDetail(req.params.id);
  if (!detail) throw new ApiError(404, 'Order not found.');
  if (detail.order.userId !== req.user!.sub && req.user!.role !== 'admin') throw new ApiError(403, 'Not your order.');
  const proofUrl = detail.order.paymentProofKey ? await signedUrl(BUCKETS.proofs, detail.order.paymentProofKey) : null;
  ok(res, { ...detail, proofUrl });
}));

export { loadOrderDetail };
