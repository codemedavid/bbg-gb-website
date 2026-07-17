import type { Request, Response, NextFunction } from 'express';
import { verifyToken, COOKIE_NAME, type JwtPayload } from '../lib/auth.js';
import { fail } from '../lib/http.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: JwtPayload }
  }
}

function tokenFrom(req: Request): string | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (cookie) return cookie;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = tokenFrom(req);
  if (!token) return fail(res, 401, 'Authentication required.');
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return fail(res, 401, 'Invalid or expired session.');
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') return fail(res, 403, 'Admin access required.');
    next();
  });
}

// Attaches user if a valid token exists, but never blocks.
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = tokenFrom(req);
  if (token) { try { req.user = verifyToken(token); } catch { /* ignore */ } }
  next();
}
