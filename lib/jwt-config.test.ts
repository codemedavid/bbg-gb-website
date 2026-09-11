// The deploy gate for the signing key behind every session cookie.
//
// Companion to lib/delivery-config.test.ts: the script gathers the facts (what
// JWT_SECRET holds, whether this is the production deploy) and this decides what
// they mean for the build.
import { describe, it, expect } from 'vitest';
import { decideJwtSecretOutcome, DEV_JWT_SECRET, MIN_JWT_SECRET_LENGTH } from './jwt-config';

const prod = (secret: string | undefined) =>
  decideJwtSecretOutcome({ secret, isProductionDeploy: true });
const preview = (secret: string | undefined) =>
  decideJwtSecretOutcome({ secret, isProductionDeploy: false });

const STRONG = 'a'.repeat(MIN_JWT_SECRET_LENGTH);

describe('production deploy', () => {
  it('blocks the build when JWT_SECRET is unset', () => {
    const outcome = prod(undefined);

    expect(outcome.blocksBuild).toBe(true);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.verified).toBe(false);
    expect(outcome.message).toContain('JWT_SECRET');
  });

  it('blocks the build when JWT_SECRET is the fallback committed in this repo', () => {
    // The whole point: the fallback is public, so a token signed with it can be
    // forged by anyone who has read lib/env.ts — including an admin token.
    const outcome = prod(DEV_JWT_SECRET);

    expect(outcome.blocksBuild).toBe(true);
    expect(outcome.exitCode).toBe(1);
  });

  it('blocks the build on a secret too short to be an HS256 key', () => {
    const outcome = prod('short');

    expect(outcome.blocksBuild).toBe(true);
    expect(outcome.exitCode).toBe(1);
  });

  it('treats whitespace as absence rather than as a secret', () => {
    expect(prod('   ').blocksBuild).toBe(true);
  });

  it('passes a real secret', () => {
    const outcome = prod(STRONG);

    expect(outcome.blocksBuild).toBe(false);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.verified).toBe(true);
  });

  it('never puts the secret itself in the message', () => {
    expect(prod(STRONG).message).not.toContain(STRONG);
  });
});

describe('preview, local and fork builds', () => {
  it('skips rather than blocks when the secret is missing', () => {
    // Blocking these would only teach people to bypass the gate.
    const outcome = preview(undefined);

    expect(outcome.blocksBuild).toBe(false);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.skipped).toBe(true);
  });

  it('does not report a skipped check as a clean bill of health', () => {
    expect(preview(undefined).verified).toBe(false);
  });

  it('still reports a real secret as verified', () => {
    expect(preview(STRONG).verified).toBe(true);
  });
});
