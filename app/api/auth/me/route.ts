import { eq } from 'drizzle-orm';
import { getDb, users } from '@/lib/db';
import { requireSession, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';

export const GET = handler(async () => {
  const session = await requireSession();
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, session.sub));
  if (!user) throw new ApiError(404, 'User not found.');
  return ok({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, role: user.role } });
});
