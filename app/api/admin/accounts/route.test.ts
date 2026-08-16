// Admin → Accounts, server side.
//
// This route hands back every customer's name, email and phone in one payload,
// which makes it the most PII-dense endpoint in the shop. Two things are
// therefore asserted here rather than assumed: only an admin may read it, and
// the password hash never rides along. A client-side role check is display, not
// protection — the gate has to be here.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  const requireAdmin = async () => {
    const s = await requireSession();
    if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
    return s;
  };
  return { ApiError, getSession: async () => session.current, requireSession, requireAdmin };
});

const { GET } = await import('./route');
const { resetDb, makeUser } = await import('@/lib/test/harness');

const req = (query = '') => new Request(`http://localhost/api/admin/accounts${query}`);

const asAdmin = async () => {
  const admin = await makeUser({ role: 'admin', email: 'admin@bbg.test' });
  session.current = { sub: admin.id, role: 'admin', email: admin.email };
};

beforeEach(async () => {
  await resetDb();
  session.current = null;
});

describe('GET /api/admin/accounts', () => {
  it('rejects an anonymous caller with 401', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('rejects a signed-in customer with 403', async () => {
    const user = await makeUser({ role: 'customer' });
    session.current = { sub: user.id, role: 'customer', email: user.email };

    const res = await GET(req());

    expect(res.status).toBe(403);
  });

  it('lists the accounts for an admin', async () => {
    await asAdmin();
    await makeUser({ email: 'ana@bbg.test' });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.map((r: { email: string }) => r.email)).toContain('ana@bbg.test');
  });

  it('never includes the password hash in the payload', async () => {
    await asAdmin();
    await makeUser({ email: 'ana@bbg.test' });

    const res = await GET(req());
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
  });

  it('passes the search term through to the query', async () => {
    await asAdmin();
    await makeUser({ email: 'ana@bbg.test' });
    await makeUser({ email: 'ben@bbg.test' });

    const res = await GET(req('?search=ana'));
    const body = await res.json();

    expect(body.data.map((r: { email: string }) => r.email)).toEqual(['ana@bbg.test']);
  });

  it('passes the role filter through to the query', async () => {
    await asAdmin();
    await makeUser({ email: 'ana@bbg.test', role: 'customer' });

    const res = await GET(req('?role=admin'));
    const body = await res.json();

    expect(body.data.map((r: { email: string }) => r.email)).toEqual(['admin@bbg.test']);
  });

  it('rejects a role that is not a real role rather than silently ignoring it', async () => {
    await asAdmin();

    const res = await GET(req('?role=superuser'));

    expect(res.status).toBe(400);
  });
});
