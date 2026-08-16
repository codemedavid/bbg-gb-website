// Token mechanics for the forgotten-password flow.
//
// Split out from the routes because both halves of the flow have to agree
// exactly: /api/auth/forgot-password stores hashResetToken(token) and mails the
// raw token, /api/auth/reset-password looks the row up by hashing what it was
// given. One shared function, so the two can never drift into "no such token".
import { createHash, randomBytes } from 'node:crypto';

// Short by design: the link is a bearer credential sitting in an inbox. Long
// enough that a customer can finish reading the mail and typing a new password.
export const RESET_TOKEN_TTL_MINUTES = 60;

const TOKEN_BYTES = 32;

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A fresh reset token: `token` goes in the email, `tokenHash` goes in the table. */
export function createResetToken(): { token: string; tokenHash: string } {
  // base64url so the token survives a URL query string untouched — no escaping
  // on the way out, no decoding surprises when the browser hands it back.
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

export function resetTokenExpiry(issuedAt: Date = new Date()): Date {
  return new Date(issuedAt.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000);
}

/**
 * Which host the emailed link should point at.
 *
 * The Host header of an inbound request is attacker-supplied. Build the link on
 * it blindly and anyone can trigger a reset for someone else's account with
 * `Host: evil.example`, mailing the victim a real token that reports back to the
 * attacker. So a configured origin (env.appUrl) always wins.
 *
 * Falling back to the request origin keeps localhost and Vercel previews — where
 * nothing is configured and no proxy is rewriting hosts — working unchanged.
 */
export function resetOrigin(requestUrl: string, configured: string): string {
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed APP_URL must not take the whole flow down.
    }
  }
  return new URL(requestUrl).origin;
}

/** The link the customer clicks. */
export function resetUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}
