// Retrying a transaction that Postgres rolled back on our behalf.
//
// Checkout takes row locks in the order the customer's cart holds them, which is
// client-controlled insertion order, so two carts naming the same counters in
// opposite order will occasionally deadlock. Postgres notices, kills one side,
// and the killed transaction is gone WHOLE — no slots claimed, no stock drawn,
// no order row. That total rollback is the licence to retry: running the closure
// again is indistinguishable from the customer having tapped Place a second
// later, which is exactly what we would otherwise ask them to do.
//
// Kept deliberately narrow, on the same principle as lib/db/db-error.ts: only
// the SQLSTATEs that mean "nothing happened, go again" qualify. A unique
// violation fails identically on every attempt and re-running it would draw
// stock down twice on the way to the same rejection; schema drift needs to reach
// an operator, not be papered over.

/**
 * Postgres SQLSTATEs whose transactions rolled back entirely and may be re-run.
 *
 * 40P01 deadlock_detected — two transactions each held what the other wanted.
 * 40001 serialization_failure — the transaction could not be ordered against a
 * concurrent one. Both are the server telling us to try again.
 */
const RETRYABLE_CODES = new Set(['40P01', '40001']);

const codeOf = (err: unknown): string | null =>
  typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
    ? err.code
    : null;

/** Whether this failure is one Postgres expects the caller to re-attempt. */
export function isRetryableTxError(err: unknown): boolean {
  const code = codeOf(err);
  return code !== null && RETRYABLE_CODES.has(code);
}

// Two victims retrying instantly and in lockstep deadlock again on the same pair
// of rows. Uneven, widening gaps break the symmetry, and jitter keeps a burst of
// checkouts at a window opening from re-colliding as a group.
const DEFAULT_DELAYS_MS = [30, 120, 350];

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms + Math.random() * ms));

type Options = {
  /** One entry per retry; its length is the number of extra attempts. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Runs `tx` and re-runs it if Postgres rolled it back as a deadlock or
 * serialization victim.
 *
 * Anything else propagates on the first attempt, untouched. When the retries are
 * exhausted the last error is rethrown as-is, so the caller can still recognise
 * it — a route wants to answer "busy, please try again" rather than the generic
 * failure a bare 500 gives the customer.
 *
 * The closure must own a whole transaction. Retrying half of one would apply the
 * first half twice.
 */
export async function withTxRetry<T>(tx: () => Promise<T>, opts: Options = {}): Promise<T> {
  const delays = opts.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return await tx();
    } catch (err) {
      if (!isRetryableTxError(err) || attempt >= delays.length) throw err;
      await sleep(delays[attempt]);
    }
  }
}
