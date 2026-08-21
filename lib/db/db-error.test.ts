// Turning a schema-drift crash into something an admin can act on.
//
// A database behind schema.ts throws a raw Postgres error deep inside a query,
// and lib/api-response.ts catches anything it does not recognise and answers a
// bare 500 "Something went wrong." That is exactly what the admin dashboard
// showed while `products.on_hand_ten_vial_php` was missing: the operator saw
// "Could not load the dashboard / Something went wrong." and had no way to tell
// a missing column apart from a dead database.
//
// Same shape of guard as lib/storage.ts, which already refuses to let a
// misconfigured storage driver reach the admin as an anonymous 500.
import { describe, it, expect } from 'vitest';
import { describeDbProblem } from './db-error';

/** The shape postgres-js and PGlite both throw: an Error carrying a SQLSTATE. */
const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('describeDbProblem', () => {
  it('names the missing column so the operator knows what drifted', () => {
    const err = pgError('42703', 'column "on_hand_ten_vial_php" does not exist');

    expect(describeDbProblem(err)).toContain('on_hand_ten_vial_php');
  });

  it('names the missing table, because a half-applied migration produces both', () => {
    const err = pgError('42P01', 'relation "moq_products" does not exist');

    expect(describeDbProblem(err)).toContain('moq_products');
  });

  it('says the database is behind schema.ts rather than blaming the request', () => {
    const err = pgError('42703', 'column "is_kahati" does not exist');

    expect(describeDbProblem(err)).toContain('schema.ts');
  });

  it('names the command that repairs it, so the fix is not a memory test', () => {
    const err = pgError('42703', 'column "is_kahati" does not exist');

    expect(describeDbProblem(err)).toContain('db:push');
  });

  it('still explains itself when the driver gives no message', () => {
    const err = Object.assign(new Error(''), { code: '42703' });

    const problem = describeDbProblem(err);

    expect(problem).toContain('schema.ts');
    expect(problem).toContain('db:push');
  });

  // Everything below is NOT drift. Claiming it is would send the operator to
  // run migrations over a bug that migrations cannot fix.
  it('ignores a unique-violation, which is a data problem and not drift', () => {
    const err = pgError('23505', 'duplicate key value violates unique constraint "orders_order_no_key"');

    expect(describeDbProblem(err)).toBeNull();
  });

  it('ignores a plain application error', () => {
    expect(describeDbProblem(new Error('boom'))).toBeNull();
  });

  it('ignores values that are not errors at all', () => {
    expect(describeDbProblem(null)).toBeNull();
    expect(describeDbProblem(undefined)).toBeNull();
    expect(describeDbProblem('42703')).toBeNull();
  });
});
