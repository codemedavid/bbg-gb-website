// Customer sign-in, and the last-sign-in stamp it leaves behind.
//
// Auth is a stateless JWT: the token is issued and forgotten, so without this
// stamp the server has no record that anyone ever signed in and Admin →
// Accounts could only ever show sign-up dates.
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

const lastLoginOf = async (email: string) => {
  const db = await getDb();
  const [row] = await db.select({ lastLoginAt: users.lastLoginAt }).from(users).where(eq(users.email, email));
  return row.lastLoginAt;
};

const req = (body: unknown) =>
  new Request('http://localhost/api/auth/login', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/auth/login', () => {
  it('signs in a customer and returns their account', async () => {
    const user = await makeUser({ role: 'customer', email: 'ana@bbg.test' });
    await setPassword(user.email, 'secret123');

    const res = await POST(req({ email: 'ana@bbg.test', password: 'secret123' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.user).toMatchObject({ email: 'ana@bbg.test', role: 'customer' });
  });

  it('stamps the last sign-in on success', async () => {
    const user = await makeUser({ role: 'customer', email: 'ana@bbg.test' });
    await setPassword(user.email, 'secret123');
    expect(await lastLoginOf('ana@bbg.test')).toBeNull();

    await POST(req({ email: 'ana@bbg.test', password: 'secret123' }));

    expect(await lastLoginOf('ana@bbg.test')).toBeInstanceOf(Date);
  });

  it('leaves the stamp alone when the password is wrong', async () => {
    const user = await makeUser({ role: 'customer', email: 'ana@bbg.test' });
    await setPassword(user.email, 'secret123');

    const res = await POST(req({ email: 'ana@bbg.test', password: 'nope' }));

    expect(res.status).toBe(401);
    expect(await lastLoginOf('ana@bbg.test')).toBeNull();
  });
});
