import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiError } from './session';
import { describeDbProblem } from './db/db-error';

export const ok = <T>(data: T, status = 200) =>
  NextResponse.json({ success: true, data, error: null }, { status });

export const fail = (status: number, message: string) =>
  NextResponse.json({ success: false, data: null, error: message }, { status });

// Wraps a Route Handler so thrown ApiError/ZodError become consistent JSON responses.
export function handler<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ZodError) {
        return fail(400, err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '));
      }
      if (err instanceof ApiError) return fail(err.status, err.message);
      console.error('[api error]', err);
      // A database behind schema.ts is the one unexpected failure whose cause
      // and remedy are both known here, so it gets said out loud rather than
      // hidden — the alternative is an admin reading "Something went wrong."
      // off a dashboard and having no way to tell drift from a dead database.
      // 503 for the same reason lib/storage.ts uses it: the deployment is
      // misconfigured, and the request succeeds unchanged once it is repaired.
      // Naming a column of our own schema is not a leak worth an outage.
      const drift = describeDbProblem(err);
      if (drift) return fail(503, drift);
      return fail(500, 'Something went wrong.');
    }
  };
}
