// Integration tests for spending a reset link.
//
// This route sets a password without knowing the old one, so the token is the
// only thing standing between a stranger and the account. Every way a token can
// be stale — used, expired, superseded, forged — has to end in a refusal.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/posthog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/posthog')>();
  return { ...actual, captureEvent: vi.fn(async () => {}) };
});

const { POST } = await import('./route');
const { resetDb, makeUser } = await import('@/lib/test/harness');
const { getDb, passwordResetTokens, users } = await import('@/lib/db');
const { verifyPassword } = await import('@/lib/auth');
const { createResetToken, resetTokenExpiry } = await import('@/lib/password-reset');
const { eq } = await import('drizzle-orm');

const req = (body: unknown) =>
  new Request('http://localhost/api/auth/reset-password', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

/** Puts a reset token in the table the way /forgot-password would have. */
async function issueToken(
  userId: string,
  overrides: { expiresAt?: Date; usedAt?: Date | null } = {},
): Promise<string> {
  const db = await getDb();
  const { token, tokenHash } = createResetToken();
  await db.insert(passwordResetTokens).values({
    userId, tokenHash,
    expiresAt: overrides.expiresAt ?? resetTokenExpiry(),
    usedAt: overrides.usedAt ?? null,
  });
  return token;
}

const passwordHashOf = async (userId: string) => {
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row.passwordHash;
};

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/auth/reset-password', () => {
  it('sets the new password for the token holder', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const token = await issueToken(user.id);

    const res = await POST(req({ token, newPassword: 'brand-new-pw' }));

    expect(res.status).toBe(200);
    expect(await verifyPassword('brand-new-pw', await passwordHashOf(user.id))).toBe(true);
  });

  it('stops the old password working', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const token = await issueToken(user.id);

    await POST(req({ token, newPassword: 'brand-new-pw' }));

    // makeUser seeds every account with this one.
    expect(await verifyPassword('password123', await passwordHashOf(user.id))).toBe(false);
  });

  it('marks the token spent', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const token = await issueToken(user.id);

    await POST(req({ token, newPassword: 'brand-new-pw' }));

    const db = await getDb();
    const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
    expect(row.usedAt).toBeInstanceOf(Date);
  });

  it('refuses the same token a second time', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const token = await issueToken(user.id);
    await POST(req({ token, newPassword: 'brand-new-pw' }));

    const res = await POST(req({ token, newPassword: 'second-attempt' }));

    expect(res.status).toBe(400);
    expect(await verifyPassword('brand-new-pw', await passwordHashOf(user.id))).toBe(true);
  });

  it('refuses an expired token', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const token = await issueToken(user.id, { expiresAt: new Date(Date.now() - 60_000) });

    const res = await POST(req({ token, newPassword: 'brand-new-pw' }));

    expect(res.status).toBe(400);
    expect(await verifyPassword('password123', await passwordHashOf(user.id))).toBe(true);
  });

  it('refuses a token that was never issued', async () => {
    await makeUser({ email: 'ana@bbg.test' });

    const res = await POST(req({ token: 'forged-token', newPassword: 'brand-new-pw' }));

    expect(res.status).toBe(400);
  });

  // An account with two links out — the customer clicked "send" twice and used
  // the older mail — must not be left with a live spare after the reset.
  it('invalidates the account\'s other outstanding links', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const spare = await issueToken(user.id);
    const token = await issueToken(user.id);

    await POST(req({ token, newPassword: 'brand-new-pw' }));

    const res = await POST(req({ token: spare, newPassword: 'someone-elses-pw' }));
    expect(res.status).toBe(400);
    expect(await verifyPassword('brand-new-pw', await passwordHashOf(user.id))).toBe(true);
  });

  it('leaves another account untouched', async () => {
    const ana = await makeUser({ email: 'ana@bbg.test' });
    const ben = await makeUser({ email: 'ben@bbg.test' });
    const token = await issueToken(ana.id);

    await POST(req({ token, newPassword: 'brand-new-pw' }));

    expect(await verifyPassword('password123', await passwordHashOf(ben.id))).toBe(true);
  });

  it('rejects a password under 8 characters', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const token = await issueToken(user.id);

    const res = await POST(req({ token, newPassword: 'short' }));

    expect(res.status).toBe(400);
    expect(await verifyPassword('password123', await passwordHashOf(user.id))).toBe(true);
  });

  // A rejected short password must not burn the link — the customer is on the
  // reset page and about to type a longer one.
  it('keeps the token usable after a rejected password', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const token = await issueToken(user.id);
    await POST(req({ token, newPassword: 'short' }));

    const res = await POST(req({ token, newPassword: 'long-enough-pw' }));

    expect(res.status).toBe(200);
  });

  it('does not name the account behind the token', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const token = await issueToken(user.id, { expiresAt: new Date(Date.now() - 60_000) });

    const res = await POST(req({ token, newPassword: 'brand-new-pw' }));

    expect(JSON.stringify(await res.json())).not.toContain('ana@bbg.test');
  });
});
