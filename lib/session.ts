import 'server-only';
import { cookies } from 'next/headers';
import { verifyToken, COOKIE_NAME, type JwtPayload } from './auth';

// Reads the session from the httpOnly cookie. Returns null when absent/invalid.
export async function getSession(): Promise<JwtPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    return await verifyToken(token);
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<JwtPayload> {
  const s = await getSession();
  if (!s) throw new ApiError(401, 'Authentication required.');
  return s;
}

export async function requireAdmin(): Promise<JwtPayload> {
  const s = await requireSession();
  if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
  return s;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
