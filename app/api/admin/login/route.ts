import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { getDb, users } from '@/lib/db';
import { verifyPassword, signToken, COOKIE_NAME, cookieOptions } from '@/lib/auth';
import { ok, handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

// Dedicated admin sign-in. Verifies credentials AND that the account is an admin,
// so a non-admin never receives an admin session cookie via this endpoint.
export const POST = handler(async (req: Request) => {
  const body = schema.parse(await req.json());
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase()));
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  if (user.role !== 'admin') {
    throw new ApiError(403, 'This account does not have admin access.');
  }
  const token = await signToken({ sub: user.id, role: user.role, email: user.email });
  (await cookies()).set(COOKIE_NAME, token, cookieOptions);
  return ok({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, role: user.role } });
});
