// lib/auth.ts refuses to sign with a secret the public already has.
//
// scripts/check-config.ts blocks a production deploy that has no real
// JWT_SECRET, so this guard is the second line: it covers the case where that
// gate was bypassed, and a control that fails open is not a control. These
// tests exist because the guard's whole value is in a branch that never runs
// locally — the one where VERCEL_ENV says customers are logging in.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEV_JWT_SECRET } from './jwt-config';

const STRONG = 'x'.repeat(48);
const ORIGINAL = { VERCEL_ENV: process.env.VERCEL_ENV, JWT_SECRET: process.env.JWT_SECRET };

/** Re-import auth.ts under a given environment — env.ts reads process.env once, at load. */
async function authUnder(vars: { VERCEL_ENV?: string; JWT_SECRET?: string }) {
  vi.resetModules();
  for (const key of ['VERCEL_ENV', 'JWT_SECRET'] as const) {
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return import('./auth');
}

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

const payload = { sub: 'u1', role: 'customer' as const, email: 'buyer@example.com' };

describe('on the production deploy', () => {
  it('refuses to sign a token when JWT_SECRET is unset', async () => {
    const { signToken } = await authUnder({ VERCEL_ENV: 'production', JWT_SECRET: undefined });

    await expect(signToken(payload)).rejects.toThrow(/JWT_SECRET/);
  });

  it('refuses to sign with the fallback committed in this repository', async () => {
    const { signToken } = await authUnder({ VERCEL_ENV: 'production', JWT_SECRET: DEV_JWT_SECRET });

    await expect(signToken(payload)).rejects.toThrow(/development fallback/);
  });

  it('refuses to VERIFY with it either, so an already-issued forgery is not honoured', async () => {
    const { verifyToken } = await authUnder({ VERCEL_ENV: 'production', JWT_SECRET: undefined });

    await expect(verifyToken('any.token.here')).rejects.toThrow(/JWT_SECRET/);
  });

  it('signs and round-trips normally once a real secret is set', async () => {
    const { signToken, verifyToken } = await authUnder({ VERCEL_ENV: 'production', JWT_SECRET: STRONG });

    const token = await signToken(payload);

    await expect(verifyToken(token)).resolves.toMatchObject(payload);
  });
});

describe('everywhere else', () => {
  it('still signs without JWT_SECRET, so local QA and previews are untouched', async () => {
    // The guard keys on VERCEL_ENV rather than NODE_ENV precisely so a local
    // `next start` — which sets NODE_ENV=production — keeps working.
    const { signToken, verifyToken } = await authUnder({ VERCEL_ENV: undefined, JWT_SECRET: undefined });

    const token = await signToken(payload);

    await expect(verifyToken(token)).resolves.toMatchObject(payload);
  });

  it('does not block a preview deploy', async () => {
    const { signToken } = await authUnder({ VERCEL_ENV: 'preview', JWT_SECRET: undefined });

    await expect(signToken(payload)).resolves.toEqual(expect.any(String));
  });
});
