// Exit-code policy for `npm run db:check`, which now gates `prebuild`.
//
// The gate has to distinguish two very different "cannot confirm" cases. A build
// with no DATABASE_URL at all (a lint-only CI job, a fork without secrets) never
// had a database to check and must not be blocked. A reachable database that is
// behind schema.ts must block, because that is precisely the state that took the
// Kahati board down with every test still green.
import { describe, it, expect } from 'vitest';
import { decideCheckOutcome } from './check-outcome';

describe('decideCheckOutcome', () => {
  it('passes when a reachable database matches the schema', () => {
    const outcome = decideCheckOutcome({ hasDatabaseUrl: true, hasDrift: false });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.blocksBuild).toBe(false);
  });

  it('blocks the build when a reachable database has drifted', () => {
    const outcome = decideCheckOutcome({ hasDatabaseUrl: true, hasDrift: true });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.blocksBuild).toBe(true);
  });

  it('skips rather than blocking when there is no database to check', () => {
    const outcome = decideCheckOutcome({ hasDatabaseUrl: false, hasDrift: false });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.blocksBuild).toBe(false);
    expect(outcome.skipped).toBe(true);
  });

  it('says out loud that it skipped, so a silent pass is not mistaken for a clean check', () => {
    const outcome = decideCheckOutcome({ hasDatabaseUrl: false, hasDrift: false });

    expect(outcome.message).toMatch(/skipp?ed/i);
    expect(outcome.message).toMatch(/DATABASE_URL/);
  });

  it('does not treat a skipped check as a verified-clean database', () => {
    const skipped = decideCheckOutcome({ hasDatabaseUrl: false, hasDrift: false });
    const verified = decideCheckOutcome({ hasDatabaseUrl: true, hasDrift: false });

    expect(skipped.verified).toBe(false);
    expect(verified.verified).toBe(true);
  });

  it('reports a connection failure as a hard error, not a skip', () => {
    // A database that should be reachable but is not is an unknown state, and
    // an unknown state must not silently pass a deploy gate.
    const outcome = decideCheckOutcome({ hasDatabaseUrl: true, hasDrift: false, connectionFailed: true });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.blocksBuild).toBe(true);
    expect(outcome.skipped).toBe(false);
  });
});
