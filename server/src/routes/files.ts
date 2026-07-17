// Dev-only local file serving (STORAGE_DRIVER=local). In prod, Supabase signed URLs are used.
import { Router } from 'express';
import { readLocal } from '../lib/storage.js';
import { asyncHandler, ApiError } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';

export const filesRouter = Router();

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
};

// GET /api/files/:bucket/*key  (auth required — proofs are private)
filesRouter.get('/:bucket/*', requireAuth, asyncHandler(async (req, res) => {
  const bucket = req.params.bucket;
  const key = (req.params as Record<string, string>)[0];
  if (!key || key.includes('..')) throw new ApiError(400, 'Bad file path.');
  try {
    const buf = await readLocal(bucket, key);
    const ext = key.split('.').pop()?.toLowerCase() || '';
    res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
    res.send(buf);
  } catch {
    throw new ApiError(404, 'File not found.');
  }
}));
