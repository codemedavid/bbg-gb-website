// Issuing a password reset link.
//
// Split out from the routes because two callers mint these now — the customer's
// own /forgot-password form and an admin recovering someone whose mail never
// arrived — and the weaker of the two would be the one an attacker used. The
// safeguards live here once so the two cannot drift apart: a fresh token, an
// expiry, and every earlier outstanding link retired.
//
// The token mechanics themselves stay in lib/password-reset.ts, which holds no
// database import and is therefore safe for both halves of the flow to share.
import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, passwordResetTokens } from './db';
import { createResetToken, resetTokenExpiry, resetUrl, RESET_TOKEN_TTL_MINUTES } from './password-reset';

export type IssuedResetLink = {
  /** The link to put in front of the customer. Carries the only copy of the raw token. */
  resetUrl: string;
  expiresInMinutes: number;
};

/**
 * Mint a reset link for `userId` on `origin`.
 *
 * Caller's job to decide *who* may ask for one — this says nothing about
 * authorisation. It also does not send anything: the emailed flow and the
 * admin flow deliver it differently, and only the raw token returned here can
 * ever be shown, since the table stores nothing but its hash.
 */
export async function issueResetLink(
  { userId, origin }: { userId: string; origin: string },
): Promise<IssuedResetLink> {
  const db = await getDb();

  // Asking for a new link retires the old ones. Two requests must not leave two
  // working keys to the account — one in an inbox, one in a chat thread.
  await db.update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));

  const { token, tokenHash } = createResetToken();
  await db.insert(passwordResetTokens).values({
    userId, tokenHash, expiresAt: resetTokenExpiry(),
  });

  return { resetUrl: resetUrl(origin, token), expiresInMinutes: RESET_TOKEN_TTL_MINUTES };
}
