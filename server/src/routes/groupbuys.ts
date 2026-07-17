import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db, groupBuys } from '../db/index.js';
import { asyncHandler, ok, ApiError } from '../lib/http.js';
import { perVialPrice } from '../lib/pricing.js';

export const groupBuysRouter = Router();

const decorate = (g: typeof groupBuys.$inferSelect) => ({
  ...g,
  perVialPhp: perVialPrice(Number(g.pricePerKitPhp)),
  remaining: g.totalSlots - g.claimedSlots,
  progress: Math.round((g.claimedSlots / g.totalSlots) * 100),
});

// GET /api/groupbuys
groupBuysRouter.get('/', asyncHandler(async (_req, res) => {
  const rows = await db.select().from(groupBuys).orderBy(desc(groupBuys.createdAt));
  ok(res, rows.map(decorate));
}));

// GET /api/groupbuys/:id
groupBuysRouter.get('/:id', asyncHandler(async (req, res) => {
  const [g] = await db.select().from(groupBuys).where(eq(groupBuys.id, req.params.id));
  if (!g) throw new ApiError(404, 'Group buy not found.');
  ok(res, decorate(g));
}));
