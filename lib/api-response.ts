import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiError } from './session';

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
      return fail(500, 'Something went wrong.');
    }
  };
}
