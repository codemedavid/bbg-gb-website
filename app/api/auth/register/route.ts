import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { getDb, users } from '@/lib/db';
import { hashPassword, signToken, COOKIE_NAME, cookieOptions } from '@/lib/auth';
import { ok, handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';

const schema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().min(7).max(40).optional(),
  password: z.string().min(8).max(100),
  address: z.string().max(500).optional(),
});

export const POST = handler(async (req: Request) => {
  const body = schema.parse(await req.json());
  const db = await getDb();
  const email = body.email.toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length) throw new ApiError(409, 'An account with this email already exists.');
  const [user] = await db.insert(users).values({
    name: body.name, email, phone: body.phone,
    passwordHash: await hashPassword(body.password), address: body.address,
  }).returning();
  const token = await signToken({ sub: user.id, role: user.role, email: user.email });
  (await cookies()).set(COOKIE_NAME, token, cookieOptions);
  return ok({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, role: user.role } }, 201);
});
