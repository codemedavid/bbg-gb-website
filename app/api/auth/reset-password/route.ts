import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, users, passwordResetTokens } from '@/lib/db';
import { hashResetToken } from '@/lib/password-reset';
import { hashPassword } from '@/lib/auth';
import { ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';

const schema = z.object({
  token: z.string().min(1).max(200),
  // Same floor as registration and the signed-in password change.
  newPassword: z.string().min(8).max(100),
});

// One message for every dead token — expired, spent, superseded, forged. Naming
// which it was tells whoever is holding it how close they got.
const DEAD_TOKEN = 'This reset link is invalid or has expired. Please request a new one.';

export const POST = handler(async (req: Request) => {
  // Parsed before the token is looked up, so a too-short password is rejected
  // without burning a link the customer is about to use properly.
  const body = schema.parse(await req.json());
  const db = await getDb();

  const [row] = await db.select().from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashResetToken(body.token)));
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) throw new ApiError(400, DEAD_TOKEN);

  await db.update(users)
    .set({ passwordHash: await hashPassword(body.newPassword) })
    .where(eq(users.id, row.userId));

  // Spend this token and retire any sibling still outstanding: after a reset the
  // account must have no live links left, whichever mail they came in.
  await db.update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.usedAt)));

  // No session is issued. The customer logs in with the password they just
  // chose, which is also how they find out it took.
  return ok({ reset: true });
});
