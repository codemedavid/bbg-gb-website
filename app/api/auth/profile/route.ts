import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@/lib/db';
import { requireSession, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';

const schema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(7).max(40).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
});

export const PATCH = handler(async (req: Request) => {
  const session = await requireSession();
  const body = schema.parse(await req.json());
  if (!Object.keys(body).length) throw new ApiError(400, 'Nothing to update.');
  const db = await getDb();
  const [user] = await db.update(users).set(body).where(eq(users.id, session.sub)).returning();
  if (!user) throw new ApiError(404, 'User not found.');
  return ok({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, role: user.role } });
});
