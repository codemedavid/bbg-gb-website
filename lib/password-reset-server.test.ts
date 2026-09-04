// Issuing a reset link, server side.
//
// Two callers mint these now: the customer's own /forgot-password form and an
// admin recovering someone who never received the mail. They have to agree
// exactly on the safeguards, because the weaker of the two is the one an
// attacker would use. One function, tested once, so they cannot drift.
import { describe, it, expect, beforeEach } from 'vitest';

const { issueResetLink } = await import('./password-reset-server');
const { hashResetToken, RESET_TOKEN_TTL_MINUTES } = await import('./password-reset');
const { resetDb, makeUser } = await import('@/lib/test/harness');
const { getDb, passwordResetTokens } = await import('@/lib/db');
const { eq } = await import('drizzle-orm');

const tokensOf = async (userId: string) => {
  const db = await getDb();
  return db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
};

const tokenIn = (url: string) => String(new URL(url).searchParams.get('token'));

beforeEach(async () => {
  await resetDb();
});

describe('issueResetLink', () => {
  it('mints a link on the origin it was given', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    const { resetUrl } = await issueResetLink({ userId: user.id, origin: 'https://www.bbgph.org' });

    expect(resetUrl).toMatch(/^https:\/\/www\.bbgph\.org\/reset-password\?token=/);
  });

  it('stores only the hash of the token, never the token itself', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    const { resetUrl } = await issueResetLink({ userId: user.id, origin: 'https://www.bbgph.org' });

    const [row] = await tokensOf(user.id);
    const token = tokenIn(resetUrl);
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashResetToken(token));
  });

  it('gives the link an expiry, so an unused one cannot sit in a chat forever', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    const { expiresInMinutes } = await issueResetLink({ userId: user.id, origin: 'https://www.bbgph.org' });

    const [row] = await tokensOf(user.id);
    expect(expiresInMinutes).toBe(RESET_TOKEN_TTL_MINUTES);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.usedAt).toBeNull();
  });

  // The invariant the emailed flow already holds: asking twice must not leave
  // two working keys to the account lying around.
  it('retires an earlier outstanding link when a second is issued', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    await issueResetLink({ userId: user.id, origin: 'https://www.bbgph.org' });
    const [first] = await tokensOf(user.id);
    await issueResetLink({ userId: user.id, origin: 'https://www.bbgph.org' });

    const live = (await tokensOf(user.id)).filter((r) => r.usedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(first.id);
  });

  it('issues a different token every time', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });

    const a = await issueResetLink({ userId: user.id, origin: 'https://www.bbgph.org' });
    const b = await issueResetLink({ userId: user.id, origin: 'https://www.bbgph.org' });

    expect(tokenIn(a.resetUrl)).not.toBe(tokenIn(b.resetUrl));
  });

  // Minting a link is an offer to change the password, not the change itself.
  it('leaves the current password working until the link is actually used', async () => {
    const user = await makeUser({ email: 'ana@bbg.test' });
    const db = await getDb();
    const { users } = await import('@/lib/db');
    const [before] = await db.select().from(users).where(eq(users.id, user.id));

    await issueResetLink({ userId: user.id, origin: 'https://www.bbgph.org' });

    const [after] = await db.select().from(users).where(eq(users.id, user.id));
    expect(after.passwordHash).toBe(before.passwordHash);
  });
});
