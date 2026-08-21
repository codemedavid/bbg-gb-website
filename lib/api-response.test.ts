// What the route wrapper tells the caller when something throws.
//
// The catch-all exists so an unexpected crash never leaks a stack trace to a
// customer, but it was swallowing the one class of failure the operator could
// actually have fixed: a database behind schema.ts. The admin dashboard read
// "Could not load the dashboard / Something went wrong." for a missing column,
// which is indistinguishable from a dead database or a bug in the query.
//
// The generic 500 stays the default. Drift is the single exception, because it
// is the only one whose cause and remedy are both known at the catch site.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { handler, ok } from './api-response';
import { ApiError } from './session';

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

/** Runs a handler that throws, and reads the envelope it answered with. */
const failureOf = async (thrown: unknown) => {
  const res = await handler(async () => { throw thrown; })();
  return { status: res.status, body: await res.json() as { success: boolean; error: string } };
};

afterEach(() => { vi.restoreAllMocks(); });

describe('handler', () => {
  it('passes a successful response through untouched', async () => {
    const res = await handler(async () => ok({ hello: 'world' }))();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: { hello: 'world' }, error: null });
  });

  it('keeps an ApiError status and message', async () => {
    const { status, body } = await failureOf(new ApiError(401, 'Authentication required.'));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required.');
  });

  it('reports a ZodError as a 400 naming the offending field', async () => {
    const schema = z.object({ qty: z.number() });
    const thrown = schema.safeParse({ qty: 'lots' });

    const { status, body } = await failureOf((thrown as { error: unknown }).error);

    expect(status).toBe(400);
    expect(body.error).toContain('qty');
  });

  it('answers schema drift with the missing column instead of a bare 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { status, body } = await failureOf(
      pgError('42703', 'column "on_hand_ten_vial_php" does not exist'),
    );

    expect(body.error).not.toBe('Something went wrong.');
    expect(body.error).toContain('on_hand_ten_vial_php');
    expect(body.error).toContain('db:push');
    // 503, matching lib/storage.ts: the deployment is misconfigured, and the
    // request would succeed unchanged once it is repaired.
    expect(status).toBe(503);
  });

  it('answers a missing table the same way', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { status, body } = await failureOf(pgError('42P01', 'relation "settlements" does not exist'));

    expect(status).toBe(503);
    expect(body.error).toContain('settlements');
  });

  it('still hides an unexpected failure behind the generic message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { status, body } = await failureOf(new Error('connect ECONNREFUSED 10.0.0.1:5432'));

    expect(status).toBe(500);
    expect(body.error).toBe('Something went wrong.');
    expect(body.error).not.toContain('ECONNREFUSED');
  });

  it('logs the real error even when it answers with the drift message', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = pgError('42703', 'column "is_kahati" does not exist');

    await failureOf(err);

    expect(logged).toHaveBeenCalledWith('[api error]', err);
  });
});
