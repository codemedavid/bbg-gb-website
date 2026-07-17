import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, users } from '../db/index.js';
import { hashPassword, verifyPassword, signToken, COOKIE_NAME, cookieOptions } from '../lib/auth.js';
import { asyncHandler, ok, ApiError } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().min(7).max(40).optional(),
  password: z.string().min(8).max(100),
  address: z.string().max(500).optional(),
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, address: u.address, role: u.role,
});

authRouter.post('/register', asyncHandler(async (req, res) => {
  const body = registerSchema.parse(req.body);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email.toLowerCase()));
  if (existing.length) throw new ApiError(409, 'An account with this email already exists.');
  const [user] = await db.insert(users).values({
    name: body.name,
    email: body.email.toLowerCase(),
    phone: body.phone,
    passwordHash: await hashPassword(body.password),
    address: body.address,
  }).returning();
  const token = signToken({ sub: user.id, role: user.role, email: user.email });
  res.cookie(COOKIE_NAME, token, cookieOptions);
  ok(res, { user: publicUser(user), token }, 201);
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase()));
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  const token = signToken({ sub: user.id, role: user.role, email: user.email });
  res.cookie(COOKIE_NAME, token, cookieOptions);
  ok(res, { user: publicUser(user), token });
}));

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
  ok(res, { loggedOut: true });
});

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.sub));
  if (!user) throw new ApiError(404, 'User not found.');
  ok(res, { user: publicUser(user) });
}));
