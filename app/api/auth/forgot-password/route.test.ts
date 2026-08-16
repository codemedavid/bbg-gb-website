// Integration tests for requesting a password reset link.
//
// The route's whole job is to hand out a single-use credential by email without
// ever telling the caller whether the address has an account — a "no such user"
// here would turn the form into a customer-list oracle for anyone with a script.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Captured = { event: string; distinctId: string; email: string; properties?: Record<string, unknown> };
const captureEvent = vi.fn(async (_input: Captured) => {});
vi.mock('@/lib/posthog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/posthog')>();
  return { ...actual, captureEvent };
});

const { POST } = await import('./route');
const { resetDb, makeUser } = await import('@/lib/test/harness');
const { getDb, passwordResetTokens, emailLog, users } = await import('@/lib/db');
const { hashResetToken } = await import('@/lib/password-reset');
const { eq } = await import('drizzle-orm');

const req = (body: unknown, origin = 'http://localhost:3000') =>
  new Request(`${origin}/api/auth/forgot-password`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

const tokensOf = async (userId: string) => {
  const db = await getDb();
  return db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
};

beforeEach(async () => {
  await resetDb();
  captureEvent.mockClear();
});

describe('POST /api/auth/forgot-password', () => {
  it('issues a reset token for a known account', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    const res = await POST(req({ email: 'ana@bbg.test' }));

    expect(res.status).toBe(200);
    const rows = await tokensOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].usedAt).toBeNull();
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('stores only the hash of the token, never the token itself', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    await POST(req({ email: 'ana@bbg.test' }));

    const [row] = await tokensOf(user.id);
    const sent = captureEvent.mock.calls[0][0];
    const token = String(new URL(String(sent.properties?.resetUrl)).searchParams.get('token'));
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashResetToken(token));
  });

  it('answers the same way for an address with no account', async () => {
    const known = await POST(req({ email: 'ana@bbg.test' }));
    const unknown = await POST(req({ email: 'ghost@bbg.test' }));

    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it('writes no token and sends no mail for an address with no account', async () => {
    await POST(req({ email: 'ghost@bbg.test' }));

    const db = await getDb();
    expect(await db.select().from(passwordResetTokens)).toHaveLength(0);
    expect(await db.select().from(emailLog)).toHaveLength(0);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it('matches the account case-insensitively, the way registration stored it', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    await POST(req({ email: 'ANA@BBG.TEST' }));

    expect(await tokensOf(user.id)).toHaveLength(1);
  });

  // Two clicks on "send link" must not leave two live keys to the account.
  it('invalidates the earlier outstanding link when a second is requested', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    await POST(req({ email: 'ana@bbg.test' }));
    const [first] = await tokensOf(user.id);
    await POST(req({ email: 'ana@bbg.test' }));

    const rows = await tokensOf(user.id);
    const live = rows.filter((r) => r.usedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(first.id);
  });

  it('mails the reset link to the account address', async () => {
    await makeUser({ email: 'ana@bbg.test' });

    await POST(req({ email: 'ana@bbg.test' }, 'https://bbgpeptides.ph'));

    const db = await getDb();
    const [mail] = await db.select().from(emailLog);
    expect(mail.toEmail).toBe('ana@bbg.test');
    expect(mail.kind).toBe('password_reset');
    expect(mail.body).toContain('https://bbgpeptides.ph/reset-password?token=');
  });

  // PostHog is what actually delivers customer mail in production (lib/posthog.ts),
  // so the link has to reach it or the customer gets nothing.
  it('captures the reset event with the link for the mail destination', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    await POST(req({ email: 'ana@bbg.test' }, 'https://bbgpeptides.ph'));

    expect(captureEvent).toHaveBeenCalledTimes(1);
    const sent = captureEvent.mock.calls[0][0];
    expect(sent.event).toBe('password_reset_requested');
    expect(sent.distinctId).toBe(user.id);
    expect(sent.email).toBe('ana@bbg.test');
    expect(String(sent.properties?.resetUrl)).toMatch(/^https:\/\/bbgpeptides\.ph\/reset-password\?token=/);
  });

  it('builds the link on the origin the request arrived at', async () => {
    await makeUser({ email: 'ana@bbg.test' });

    await POST(req({ email: 'ana@bbg.test' }, 'http://localhost:3000'));

    expect(String(captureEvent.mock.calls[0][0].properties?.resetUrl))
      .toMatch(/^http:\/\/localhost:3000\/reset-password\?token=/);
  });

  it('rejects a malformed email address', async () => {
    const res = await POST(req({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
  });

  it('leaves the existing password working until the link is used', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const db = await getDb();
    const [before] = await db.select().from(users).where(eq(users.id, user.id));

    await POST(req({ email: 'ana@bbg.test' }));

    const [after] = await db.select().from(users).where(eq(users.id, user.id));
    expect(after.passwordHash).toBe(before.passwordHash);
  });
});
