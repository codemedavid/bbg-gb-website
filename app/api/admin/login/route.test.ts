// Integration tests for the dedicated admin-login route.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// next/headers cookies() needs a request scope that vitest lacks; stub the setter.
vi.mock('next/headers', () => ({ cookies: async () => ({ set: () => {} }) }));

const { POST } = await import('./route');
const { resetDb, makeUser } = await import('@/lib/test/harness');
const { getDb, users } = await import('@/lib/db');
const { hashPassword } = await import('@/lib/auth');
const { eq } = await import('drizzle-orm');

async function setPassword(email: string, password: string) {
  const db = await getDb();
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.email, email));
}

const req = (body: unknown) =>
  new Request('http://localhost/api/admin/login', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/admin/login', () => {
  it('signs in an admin and returns the admin user', async () => {
    const admin = await makeUser({ role: 'admin', email: 'admin@bbg.test' });
    await setPassword(admin.email, 'secret123');
    const res = await POST(req({ email: 'admin@bbg.test', password: 'secret123' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.user).toMatchObject({ email: 'admin@bbg.test', role: 'admin' });
  });

  it('rejects a valid non-admin account with 403', async () => {
    const customer = await makeUser({ role: 'customer', email: 'ana@bbg.test' });
    await setPassword(customer.email, 'secret123');
    const res = await POST(req({ email: 'ana@bbg.test', password: 'secret123' }));
    expect(res.status).toBe(403);
  });

  it('rejects a wrong password with 401', async () => {
    const admin = await makeUser({ role: 'admin', email: 'admin2@bbg.test' });
    await setPassword(admin.email, 'secret123');
    const res = await POST(req({ email: 'admin2@bbg.test', password: 'nope' }));
    expect(res.status).toBe(401);
  });

  it('rejects an unknown account with 401', async () => {
    const res = await POST(req({ email: 'ghost@bbg.test', password: 'whatever' }));
    expect(res.status).toBe(401);
  });
});
