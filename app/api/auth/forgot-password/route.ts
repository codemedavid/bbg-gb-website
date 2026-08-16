import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, users, passwordResetTokens } from '@/lib/db';
import {
  createResetToken, resetOrigin, resetTokenExpiry, resetUrl, RESET_TOKEN_TTL_MINUTES,
} from '@/lib/password-reset';
import { env } from '@/lib/env';
import { sendEmail, passwordResetEmail } from '@/lib/email';
import { captureEvent } from '@/lib/posthog';
import { ok, handler } from '@/lib/api-response';

const schema = z.object({ email: z.string().email().max(200) });

// Deliberately identical whether or not the address has an account. Anything
// else — a 404, a different message, even a different shape — turns this open
// form into a way to ask "does this person buy from BBG?" one address at a time.
const GENERIC = { sent: true as const };

export const POST = handler(async (req: Request) => {
  const body = schema.parse(await req.json());
  const email = body.email.toLowerCase();
  const db = await getDb();

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) return ok(GENERIC);

  // Requesting a new link retires the old ones. Two clicks on "send link" must
  // not leave two working keys to the account lying in an inbox.
  await db.update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

  const { token, tokenHash } = createResetToken();
  await db.insert(passwordResetTokens).values({
    userId: user.id, tokenHash, expiresAt: resetTokenExpiry(),
  });

  const link = resetUrl(resetOrigin(req.url, env.appUrl), token);
  await sendEmail({
    to: user.email,
    ...passwordResetEmail({ name: user.name, resetUrl: link, expiresInMinutes: RESET_TOKEN_TTL_MINUTES }),
    kind: 'password_reset',
  });
  // PostHog is what actually delivers customer mail here (lib/posthog.ts), so the
  // link has to travel as a property or the destination has nothing to send.
  await captureEvent({
    event: 'password_reset_requested',
    distinctId: user.id,
    email: user.email,
    name: user.name,
    properties: { resetUrl: link, expiresInMinutes: RESET_TOKEN_TTL_MINUTES },
  });

  return ok(GENERIC);
});
