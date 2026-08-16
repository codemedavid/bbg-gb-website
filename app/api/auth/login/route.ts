import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { getDb, users } from '@/lib/db';
import { verifyPassword, signToken, COOKIE_NAME, cookieOptions } from '@/lib/auth';
import { ok, handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const POST = handler(async (req: Request) => {
  const body = schema.parse(await req.json());
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase()));
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  // The only record that this account was ever used: the token below is
  // stateless, so nothing else would remember. Stamped after the password
  // check, so a failed attempt never shows up as activity.
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const token = await signToken({ sub: user.id, role: user.role, email: user.email });
  (await cookies()).set(COOKIE_NAME, token, cookieOptions);
  return ok({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, role: user.role } });
});
