// Exit-code policy for the schema-drift gate that guards `prebuild`.
//
// Split out from the script so the policy itself is testable — the script only
// gathers facts (is there a URL, did the connection work, is there drift) and
// this decides what they mean for the build.

export type CheckInputs = {
  hasDatabaseUrl: boolean;
  hasDrift: boolean;
  /** The URL was present but the database could not be reached or queried. */
  connectionFailed?: boolean;
};

export type CheckOutcome = {
  exitCode: 0 | 1 | 2;
  blocksBuild: boolean;
  /** No database was configured, so nothing was checked. */
  skipped: boolean;
  /** True only when a real database was reached and confirmed to match. */
  verified: boolean;
  message: string;
};

export function decideCheckOutcome(
  { hasDatabaseUrl, hasDrift, connectionFailed = false }: CheckInputs,
): CheckOutcome {
  // Nothing to check against. A lint-only CI job or a fork without secrets never
  // had a database, and blocking it would just teach people to bypass the gate.
  if (!hasDatabaseUrl) {
    return {
      exitCode: 0,
      blocksBuild: false,
      skipped: true,
      verified: false,
      message: 'Schema drift check SKIPPED — DATABASE_URL is not set, so there is no database to '
        + 'compare against. This is not a clean bill of health: set DATABASE_URL in the build '
        + 'environment so drift is actually caught before deploy.',
    };
  }

  // A database that should be reachable but is not leaves the schema in an
  // unknown state, and an unknown state must not quietly pass a deploy gate.
  if (connectionFailed) {
    return {
      exitCode: 2,
      blocksBuild: true,
      skipped: false,
      verified: false,
      message: 'Schema drift check FAILED — DATABASE_URL is set but the database could not be '
        + 'reached, so drift could not be ruled out.',
    };
  }

  if (hasDrift) {
    return {
      exitCode: 1,
      blocksBuild: true,
      skipped: false,
      verified: false,
      message: 'Schema drift check FAILED — the database is behind schema.ts.',
    };
  }

  return {
    exitCode: 0,
    blocksBuild: false,
    skipped: false,
    verified: true,
    message: 'Database matches schema.ts — no drift.',
  };
}
