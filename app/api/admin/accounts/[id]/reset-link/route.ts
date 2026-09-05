import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, users } from '@/lib/db';
import { issueResetLink } from '@/lib/password-reset-server';
import { resetOrigin } from '@/lib/password-reset';
import { env } from '@/lib/env';
import { sendEmail, passwordResetEmail } from '@/lib/email';
import { captureEvent } from '@/lib/posthog';

// Admin → Accounts → "Issue reset link".
//
// The customer's own /forgot-password form is the front door and stays the front
// door. This is the fallback for when the mail does not arrive, which on this
// shop is not hypothetical: account recovery depends on a PostHog workflow, and
// that has failed twice — once on the workflow's re-entry rule (2026-08-17..31,
// 144 links, 0 completed resets), once on a missing POSTHOG_KEY in production
// (2026-09-02 onward). Both times the customer's only way back in was to
// register a new email address and abandon their order history.
//
// So an admin mints the link and hands it over on WhatsApp or Messenger, which
// is where BBG already talks to these customers.

// The id comes off the URL, and users.id is a uuid column — an unparseable one
// would reach Postgres as a cast error and surface as a 500. Rejected here so a
// bad id reads as a bad request.
const params = z.object({ id: z.string().uuid() });

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  // Before the id is even looked at, so a non-admin cannot use this endpoint to
  // probe which account ids exist.
  await requireAdmin();
  const { id } = params.parse(await ctx.params);

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new ApiError(404, 'No account with that id.');

  // This endpoint exists to recover locked-out *customers*. Minting a credential
  // for another administrator is privilege escalation, and no support case needs
  // it — an admin who forgets their password uses the ordinary emailed flow.
  if (user.role !== 'customer') {
    throw new ApiError(400, 'Reset links can only be issued for customer accounts.');
  }

  const { resetUrl, expiresInMinutes } = await issueResetLink({
    userId: user.id,
    origin: resetOrigin(req.url, env.appUrl),
  });

  // Still mailed. If delivery happens to be working the customer can finish on
  // their own instead of waiting for someone to paste a link at them, and the
  // email_log row is the record that a credential was issued for this account.
  // Neither half may fail the request: a dead mail channel is the situation this
  // endpoint was built for, and the link in the response is the deliverable.
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

  return ok({ email: user.email, resetUrl, expiresInMinutes });
});
