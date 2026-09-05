import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@/lib/db';
import { resetOrigin } from '@/lib/password-reset';
import { issueResetLink } from '@/lib/password-reset-server';
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

  // Shared with Admin → Accounts' "Issue reset link" (lib/password-reset-server.ts).
  // Both doors into an account have to carry the same safeguards — expiry, single
  // use, and retiring any link already outstanding — and one function is the only
  // way they cannot drift apart.
  const { resetUrl, expiresInMinutes } = await issueResetLink({
    userId: user.id,
    origin: resetOrigin(req.url, env.appUrl),
  });

  // PostHog delivers this mail (docs/posthog-events.md), so the capture *is* the
  // send and the link has to travel as a property or the workflow has nothing to
  // put in the email. It runs before the audit row is written, so the row can
  // record what actually happened instead of assuming it worked — the assumption
  // is what hid 144 undelivered resets for two weeks.
  const delivery = await captureEvent({
    event: 'password_reset_requested',
    distinctId: user.id,
    email: user.email,
    name: user.name,
    properties: { resetUrl, expiresInMinutes },
  });

  await sendEmail({
    to: user.email,
    ...passwordResetEmail({ name: user.name, resetUrl, expiresInMinutes }),
    kind: 'password_reset',
    delivery,
  });

  // Still the generic answer even when delivery failed. The customer can retry,
  // Admin → Emails shows the failure, an admin can hand the link over directly,
  // and a stranger still learns nothing.
  return ok(GENERIC);
});
