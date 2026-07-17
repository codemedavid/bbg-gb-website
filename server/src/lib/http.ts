// Small helpers for consistent API responses + async route error handling.
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const asyncHandler = (fn: RequestHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);

export const ok = <T>(res: Response, data: T, status = 200) => res.status(status).json({ success: true, data, error: null });
export const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, data: null, error: message });
