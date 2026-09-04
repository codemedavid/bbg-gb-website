// Retrying the one class of failure that is safe to retry.
//
// A checkout claims rows across several tables in one transaction, and the order
// it claims them in comes from the customer's cart — client-controlled insertion
// order. Two customers holding the same two kahati counters in opposite order
// deadlock: Postgres detects it, kills one transaction with SQLSTATE 40P01, and
// that error is not an ApiError, so lib/api-response.ts answered it with a bare
// 500 "Something went wrong." The customer's whole checkout died on a collision
// that resolves itself if you simply ask again — and it is likeliest during the
// window-open burst, when the most people are checking out at once.
//
// A deadlock victim's transaction has fully rolled back: no rows claimed, no
// stock drawn, nothing half-written. That is exactly what makes it retryable,
// and it is why this is narrow — only the two SQLSTATEs Postgres uses to say
// "nothing happened, go again" qualify. A constraint violation or a dead
// connection means something else and must surface unchanged.
import { describe, it, expect, vi } from 'vitest';
import { isRetryableTxError, withTxRetry } from './tx-retry';

/** A driver error as postgres-js surfaces it: an Error carrying `code`. */
const pgError = (code: string, message = 'boom') =>
  Object.assign(new Error(message), { code });

const DEADLOCK = '40P01';
const SERIALIZATION = '40001';

describe('isRetryableTxError', () => {
  it('recognises a deadlock victim', () => {
    expect(isRetryableTxError(pgError(DEADLOCK, 'deadlock detected'))).toBe(true);
  });

  it('recognises a serialization failure', () => {
    // The same promise as a deadlock: the transaction rolled back whole.
    expect(isRetryableTxError(pgError(SERIALIZATION))).toBe(true);
  });

  it('refuses a unique-violation, which will fail identically every time', () => {
    expect(isRetryableTxError(pgError('23505'))).toBe(false);
  });

  it('refuses schema drift, which a retry only repeats', () => {
    // 42703 is a missing column. Retrying hides it from the operator who needs
    // to see it — lib/db/db-error.ts exists to report it.
    expect(isRetryableTxError(pgError('42703'))).toBe(false);
  });

  it('refuses an error with no SQLSTATE at all', () => {
    expect(isRetryableTxError(new Error('socket hang up'))).toBe(false);
    expect(isRetryableTxError(null)).toBe(false);
    expect(isRetryableTxError('40P01')).toBe(false);
  });
});

describe('withTxRetry', () => {
  it('returns the result untouched when nothing goes wrong', async () => {
    const run = vi.fn(async () => 'placed');

    await expect(withTxRetry(run)).resolves.toBe('placed');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs the transaction again after a deadlock and returns the retry’s result', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(pgError(DEADLOCK, 'deadlock detected'))
      .mockResolvedValue('placed');

    await expect(withTxRetry(run, { delaysMs: [0] })).resolves.toBe('placed');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured attempts and rethrows the last deadlock', async () => {
    // The caller still has to answer the customer; it just gets to answer with
    // "busy, try again" instead of "something went wrong".
    const err = pgError(DEADLOCK, 'deadlock detected');
    const run = vi.fn().mockRejectedValue(err);

    await expect(withTxRetry(run, { delaysMs: [0, 0] })).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-retryable error immediately, without a second attempt', async () => {
    // Re-running a transaction that failed on a unique key would draw stock down
    // a second time on the way to the same rejection.
    const err = pgError('23505');
    const run = vi.fn().mockRejectedValue(err);

    await expect(withTxRetry(run, { delaysMs: [0, 0] })).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits between attempts so the winner can finish first', async () => {
    // Two transactions retrying instantly and in lockstep deadlock again on the
    // same pair of rows. The gap is what breaks the symmetry.
    const slept: number[] = [];
    const run = vi.fn()
      .mockRejectedValueOnce(pgError(DEADLOCK))
      .mockResolvedValue('placed');

    await withTxRetry(run, { delaysMs: [25], sleep: async (ms) => { slept.push(ms); } });

    expect(slept).toEqual([25]);
  });
});
