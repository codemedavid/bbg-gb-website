import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError, fail } from '../lib/http.js';

export function notFound(_req: Request, res: Response) {
  fail(res, 404, 'Not found.');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const msg = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    return fail(res, 400, msg || 'Validation failed.');
  }
  if (err instanceof ApiError) return fail(res, err.status, err.message);
  console.error('[error]', err);
  return fail(res, 500, 'Something went wrong.');
}
