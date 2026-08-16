import { describe, it, expect } from 'vitest';
import {
  RESET_TOKEN_TTL_MINUTES, createResetToken, hashResetToken, resetOrigin, resetTokenExpiry, resetUrl,
} from './password-reset';

describe('createResetToken', () => {
  it('returns a URL-safe token and its hash', () => {
    const { token, tokenHash } = createResetToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the same token twice', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createResetToken().token));

    expect(tokens.size).toBe(200);
  });

  // Guessing the link must be hopeless: this is a bearer credential for the account.
  it('carries at least 32 bytes of entropy', () => {
    const { token } = createResetToken();

    expect(Buffer.from(token, 'base64url').length).toBeGreaterThanOrEqual(32);
  });

  it('hashes the token the same way hashResetToken does', () => {
    const { token, tokenHash } = createResetToken();

    expect(hashResetToken(token)).toBe(tokenHash);
  });
});

describe('hashResetToken', () => {
  it('is stable for the same token', () => {
    expect(hashResetToken('abc')).toBe(hashResetToken('abc'));
  });

  it('differs for different tokens', () => {
    expect(hashResetToken('abc')).not.toBe(hashResetToken('abd'));
  });

  // The stored hash is what a lookup matches on. If the raw token ever equalled
  // it, the table would hold a working link.
  it('does not return the token itself', () => {
    expect(hashResetToken('abc')).not.toBe('abc');
  });
});

describe('resetTokenExpiry', () => {
  it('expires the token a fixed window after it was issued', () => {
    const now = new Date('2026-08-16T10:00:00Z');

    const expiry = resetTokenExpiry(now);

    expect(expiry.getTime() - now.getTime()).toBe(RESET_TOKEN_TTL_MINUTES * 60_000);
  });

  it('keeps the window short enough that a leaked link goes stale within the hour', () => {
    expect(RESET_TOKEN_TTL_MINUTES).toBeLessThanOrEqual(60);
  });
});

describe('resetOrigin', () => {
  it('falls back to the request origin when nothing is configured', () => {
    expect(resetOrigin('http://localhost:3000/api/auth/forgot-password', '')).toBe('http://localhost:3000');
  });

  // Host-header injection: the Host of an inbound request is attacker-supplied,
  // and a reset link built on it would mail the victim a token pointing at the
  // attacker's server. A configured origin is the one the mail must use.
  it('prefers the configured origin over the request host', () => {
    expect(resetOrigin('https://evil.example/api/auth/forgot-password', 'https://bbgpeptides.ph'))
      .toBe('https://bbgpeptides.ph');
  });

  it('keeps only the origin of a configured URL that carries a path', () => {
    expect(resetOrigin('https://evil.example/x', 'https://bbgpeptides.ph/shop')).toBe('https://bbgpeptides.ph');
  });

  // A typo'd APP_URL must not take the flow down — the request origin is right
  // in every environment that is not behind a rewriting proxy.
  it('falls back to the request origin when the configured value is not a URL', () => {
    expect(resetOrigin('http://localhost:3000/x', 'bbgpeptides.ph')).toBe('http://localhost:3000');
  });
});

describe('resetUrl', () => {
  it('builds the reset link on the requesting origin', () => {
    expect(resetUrl('https://bbgpeptides.ph', 'tok123'))
      .toBe('https://bbgpeptides.ph/reset-password?token=tok123');
  });

  it('drops a trailing slash rather than emitting a double slash', () => {
    expect(resetUrl('https://bbgpeptides.ph/', 'tok123'))
      .toBe('https://bbgpeptides.ph/reset-password?token=tok123');
  });

  it('percent-encodes the token', () => {
    expect(resetUrl('https://bbgpeptides.ph', 'a+b/c=')).toContain('token=a%2Bb%2Fc%3D');
  });
});
