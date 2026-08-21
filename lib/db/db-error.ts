// Recognises the one runtime failure that means "the database is behind
// schema.ts", so lib/api-response.ts can answer it with a remedy instead of a
// bare 500.
//
// scripts/check-schema.ts catches drift before a deploy, but only when
// DATABASE_URL is set in the build environment; when it is not, the check skips
// and the drift surfaces later as a query blowing up mid-request. This is the
// second half of that guard — the one that runs when the first was skipped.
//
// Deliberately narrow. Only the two SQLSTATEs that mean "the thing the code
// asked for is not there" qualify; a constraint violation or a dropped
// connection is a different problem, and sending an operator to run migrations
// over it would waste the outage.

import { PGLITE_LOCKED } from './pglite-lock';

/** Postgres SQLSTATEs for a column/table the query named but the database lacks. */
const DRIFT_CODES = new Set(['42703', '42P01']);

const REMEDY = 'Run `npm run db:check` to see the full drift, then `npm run db:push` to apply it.';

const codeOf = (err: unknown): string | null =>
  typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
    ? err.code
    : null;

/**
 * A message naming what drifted and how to repair it, or null when the error is
 * not schema drift and the caller should fall back to its generic response.
 */
export function describeDbProblem(err: unknown): string | null {
  const code = codeOf(err);

  // The single-writer guard already wrote its message for a developer; it needs
  // carrying, not rephrasing.
  if (code === PGLITE_LOCKED && err instanceof Error) return err.message;

  if (!DRIFT_CODES.has(code ?? '')) return null;

  // Postgres already words this well ("column \"is_kahati\" does not exist"),
  // and it is the only place the identifier appears — the driver does not break
  // it out into a field we could format ourselves.
  const detail = (err instanceof Error && err.message.trim())
    || 'a column or table the code expects is missing';

  return `The database is behind schema.ts: ${detail}. ${REMEDY}`;
}
