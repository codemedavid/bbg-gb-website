// Admin → Accounts → "Issue reset link".
//
// Why this endpoint exists: account recovery has only ever had one channel, and
// that channel is a third party. It broke twice in three weeks — first the
// PostHog workflow's re-entry rule (2026-08-17..08-31, 144 links, 0 completed
// resets), then a missing POSTHOG_KEY in production (2026-09-02 onward, every
// customer email silently undelivered). Both times the customer's only way back
// in was to register a *new email address*, abandoning their order history.
//
// So an admin can mint the link and hand it over on the channel BBG already uses
// to talk to customers. That is a credential-minting endpoint, which is why the
// safeguards below are asserted and not assumed: it has to be exactly as strong
// as the emailed flow, and it must not become a way for one staff session to
// take over another administrator's account.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  const requireAdmin = async () => {
    const s = await requireSession();
    if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
    return s;
  };
  return { ApiError, getSession: async () => session.current, requireSession, requireAdmin };
});

type Captured = { event: string; distinctId: string; email: string; properties?: Record<string, unknown> };
const captureEvent = vi.fn(async (_input: Captured) => ({ ok: true }) as { ok: boolean; error?: string });
vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureEvent,
}));

const { POST } = await import('./route');
const { POST: RESET } = await import('@/app/api/auth/reset-password/route');
const { resetDb, makeUser } = await import('@/lib/test/harness');
const { getDb, passwordResetTokens, users, emailLog } = await import('@/lib/db');
const { hashResetToken } = await import('@/lib/password-reset');
const { verifyPassword } = await import('@/lib/auth');
const { eq } = await import('drizzle-orm');

const ORIGIN = 'https://www.bbgph.org';

const issue = (id: string, origin = ORIGIN) => POST(
  new Request(`${origin}/api/admin/accounts/${id}/reset-link`, { method: 'POST' }),
  { params: Promise.resolve({ id }) },
);

const useLink = (resetUrl: string, newPassword: string) => RESET(
  new Request('https://www.bbgph.org/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: new URL(resetUrl).searchParams.get('token'), newPassword }),
  }),
);

const asAdmin = async () => {
  const admin = await makeUser({ role: 'admin', email: 'admin@bbg.test' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
  return admin;
};

const tokensOf = async (userId: string) => {
  const db = await getDb();
  return db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
};

const hashOf = async (userId: string) => {
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row.passwordHash;
};

beforeEach(async () => {
  await resetDb();
  session.current = null;
  captureEvent.mockReset();
  captureEvent.mockResolvedValue({ ok: true });
});

describe('POST /api/admin/accounts/[id]/reset-link', () => {
  it('rejects an anonymous caller with 401', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    const res = await issue(user.id);

    expect(res.status).toBe(401);
  });

  // A customer must not be able to mint a link for anybody — least of all for
  // their own account, which would sidestep the emailed flow's whole point.
  it('rejects a signed-in customer with 403', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    session.current = { sub: user.id, role: 'customer', email: user.email };

    const res = await issue(user.id);

    expect(res.status).toBe(403);
  });

  it('writes no token when the caller is not an admin', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    await issue(user.id);

    expect(await tokensOf(user.id)).toHaveLength(0);
  });

  it('returns 404 for an account that does not exist', async () => {
    await asAdmin();

    const res = await issue('99999999-9999-4999-8999-999999999999');

    expect(res.status).toBe(404);
  });

  it('hands the admin a reset link for the customer', async () => {
    await asAdmin();
    const user = await makeUser({ email: 'ana@bbg.test' });

    const res = await issue(user.id);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.email).toBe('ana@bbg.test');
    expect(body.data.resetUrl).toMatch(/^https:\/\/www\.bbgph\.org\/reset-password\?token=/);
    expect(body.data.expiresInMinutes).toBe(60);
  });

  it('stores only the hash of the token it just handed out', async () => {
    await asAdmin();
    const user = await makeUser({ email: 'ana@bbg.test' });

    const body = await (await issue(user.id)).json();

    const [row] = await tokensOf(user.id);
    const token = String(new URL(body.data.resetUrl).searchParams.get('token'));
    expect(row.tokenHash).toBe(hashResetToken(token));
    expect(row.tokenHash).not.toBe(token);
  });

  // The journey this whole endpoint exists for: the customer who could not
  // receive the mail gets back into the account they already have.
  it('issues a link that actually resets the customer password', async () => {
    await asAdmin();
    const user = await makeUser({ email: 'ana@bbg.test' });
    const before = await hashOf(user.id);

    const body = await (await issue(user.id)).json();
    const res = await useLink(body.data.resetUrl, 'brand-new-password');

    expect(res.status).toBe(200);
    const after = await hashOf(user.id);
    expect(after).not.toBe(before);
    expect(await verifyPassword('brand-new-password', after)).toBe(true);
  });

  it('leaves the old password working until the link is used', async () => {
    await asAdmin();
    const user = await makeUser({ email: 'ana@bbg.test' });

    await issue(user.id);

    expect(await verifyPassword('password123', await hashOf(user.id))).toBe(true);
  });

  // Single use, same as the emailed one. An admin-issued link that still works
  // after the customer used it is a standing key in a chat thread.
  it('refuses the same link a second time', async () => {
    await asAdmin();
    const user = await makeUser({ email: 'ana@bbg.test' });

    const body = await (await issue(user.id)).json();
    await useLink(body.data.resetUrl, 'brand-new-password');
    const again = await useLink(body.data.resetUrl, 'another-password');

    expect(again.status).toBe(400);
  });

  it('retires an earlier outstanding link, so only one key is ever live', async () => {
    await asAdmin();
    const user = await makeUser({ email: 'ana@bbg.test' });

    const first = await (await issue(user.id)).json();
    await issue(user.id);

    const dead = await useLink(first.data.resetUrl, 'brand-new-password');
    expect(dead.status).toBe(400);
    expect((await tokensOf(user.id)).filter((r) => r.usedAt === null)).toHaveLength(1);
  });

  // A staff session is not a route to another administrator's account. This
  // endpoint exists to recover locked-out *customers*; minting a credential for
  // an admin is privilege escalation with no reason to be reachable here.
  it('refuses to issue a link for an admin account', async () => {
    await asAdmin();
    const other = await makeUser({ role: 'admin', email: 'owner@bbg.test' });

    const res = await issue(other.id);

    expect(res.status).toBe(400);
    expect(await tokensOf(other.id)).toHaveLength(0);
  });

  it('never returns the password hash', async () => {
    await asAdmin();
    const user = await makeUser({ email: 'ana@bbg.test' });

    const raw = JSON.stringify(await (await issue(user.id)).json());

    expect(raw).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
  });

  // The admin route is the fallback, not a replacement: if PostHog is working
  // the customer should still get the mail, so they can finish without waiting
  // on a human to paste anything.
  it('still tries to mail the customer, and records what became of it', async () => {
    await asAdmin();
    const user = await makeUser({ email: 'ana@bbg.test' });

    await issue(user.id);

    expect(captureEvent).toHaveBeenCalledTimes(1);
    expect(captureEvent.mock.calls[0][0]).toMatchObject({
      event: 'password_reset_requested', distinctId: user.id, email: 'ana@bbg.test',
    });
    const db = await getDb();
    const [mail] = await db.select().from(emailLog);
    expect(mail.kind).toBe('password_reset');
    expect(mail.status).toBe('sent');
  });

  // The link is the deliverable. A dead mail channel is exactly the situation
  // this endpoint was built for, so it must not turn into an error.
  it('still returns the link when the mail could not be delivered', async () => {
    await asAdmin();
    const user = await makeUser({ email: 'ana@bbg.test' });
    captureEvent.mockResolvedValue({ ok: false, error: 'POSTHOG_KEY is not set, so nothing was sent.' });

    const res = await issue(user.id);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.resetUrl).toMatch(/\/reset-password\?token=/);
    const db = await getDb();
    const [mail] = await db.select().from(emailLog);
    expect(mail.status).toBe('failed');
    expect(mail.error).toContain('POSTHOG_KEY');
  });
});
