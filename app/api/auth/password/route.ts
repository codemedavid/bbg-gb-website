import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@/lib/db';
import { requireSession, ApiError } from '@/lib/session';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { ok, handler } from '@/lib/api-response';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const POST = handler(async (req: Request) => {
  const session = await requireSession();
  const body = schema.parse(await req.json());
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, session.sub));
  if (!user) throw new ApiError(404, 'User not found.');

  // Verify the current password before allowing a change.
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw new ApiError(401, 'Your current password is incorrect.');
  }
  if (await verifyPassword(body.newPassword, user.passwordHash)) {
    throw new ApiError(400, 'New password must be different from your current one.');
  }
  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, user.id));
  return ok({ changed: true });
});
