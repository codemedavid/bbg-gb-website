import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, coaFiles } from '../db/index.js';
import { asyncHandler, ok, ApiError } from '../lib/http.js';
import { signedUrl } from '../lib/storage.js';
import { BUCKETS } from '../lib/env.js';

export const coaRouter = Router();

// GET /api/coa/product/:productId  -> list of COA files for a product
coaRouter.get('/product/:productId', asyncHandler(async (req, res) => {
  const rows = await db.select().from(coaFiles).where(eq(coaFiles.productId, req.params.productId));
  ok(res, rows);
}));

// GET /api/coa/:id/download  -> signed URL (redirect) to the COA PDF
coaRouter.get('/:id/download', asyncHandler(async (req, res) => {
  const [coa] = await db.select().from(coaFiles).where(eq(coaFiles.id, req.params.id));
  if (!coa) throw new ApiError(404, 'COA not found for this batch yet. Message us and we\'ll send it over.');
  const url = await signedUrl(BUCKETS.coa, coa.storageKey);
  res.redirect(url);
}));
