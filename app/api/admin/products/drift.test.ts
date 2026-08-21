// The drift guard against a real drifted database.
//
// lib/api-response.test.ts proves handler() reacts to SQLSTATE 42703, but it
// builds that error by hand. This file drops a column the route selects and
// lets the driver raise the error itself, so the guard cannot pass on an error
// shape that drizzle and PGlite never actually produce.
//
// This is the exact failure the admin hit: schema.ts declared
// products.on_hand_ten_vial_php before the migration reached the database, and
// every admin products request answered a bare 500.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  return {
    ApiError,
    getSession: async () => session.current,
    requireSession: async () => {
      if (!session.current) throw new ApiError(401, 'Authentication required.');
      return session.current;
    },
    requireAdmin: async () => {
      if (!session.current) throw new ApiError(401, 'Authentication required.');
      if (session.current.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return session.current;
    },
  };
});

const { GET } = await import('./route');
const { migrateOnce, resetDb, makeUser } = await import('@/lib/test/harness');
const { getDb } = await import('@/lib/db');

beforeEach(async () => {
  await migrateOnce();
  await resetDb();
  const admin = await makeUser({ role: 'admin' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// resetDb truncates rows but does not rebuild the schema, and migrateOnce is a
// no-op after the first call — so a dropped column would leak into every later
// test in this file. Put it back rather than relying on test order.
afterEach(async () => {
  const db = await getDb();
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`alter table products add column if not exists on_hand_ten_vial_php numeric(12, 2)`);
});

describe('admin products against a database behind schema.ts', () => {
  it('names the missing column and the repair command', async () => {
    const db = await getDb();
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`alter table products drop column on_hand_ten_vial_php`);

    const res = await GET();
    const body = await res.json() as { success: boolean; error: string };

    expect(body.error).not.toBe('Something went wrong.');
    expect(body.error).toContain('on_hand_ten_vial_php');
    expect(body.error).toContain('db:push');
    expect(res.status).toBe(503);
  });

  it('answers normally once the column is there', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
  });
});
