// Integration tests for the admin settings (GET + PATCH): packing fees + kahati downpayment.
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
  return {
    ApiError,
    getSession: async () => session.current,
    requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { GET, PATCH } = await import('./route');
const { resetDb, makeUser } = await import('@/lib/test/harness');

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

function patchReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/settings', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
  session.current = null;
});

describe('GET /api/admin/settings', () => {
  it('returns the code-default packing fees when unset (200/150/300/300)', async () => {
    await signIn('admin');
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.packingFees).toEqual({ solo: 200, kahati: 150, group_buy: 300, moq: 300 });
  });

  it('requires admin', async () => {
    await signIn('customer');
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/settings', () => {
  it('updates a packing fee and persists it', async () => {
    await signIn('admin');
    const res = await PATCH(patchReq({ packingFees: { solo: 250 } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.packingFees.solo).toBe(250);
    // Unspecified modes keep their defaults.
    expect(body.data.packingFees.kahati).toBe(150);

    const after = await GET();
    expect((await after.json()).data.packingFees.solo).toBe(250);
  });

  it('rejects a negative fee', async () => {
    await signIn('admin');
    const res = await PATCH(patchReq({ packingFees: { solo: -5 } }));
    expect(res.status).toBe(400);
  });

  it('requires admin', async () => {
    await signIn('customer');
    const res = await PATCH(patchReq({ packingFees: { solo: 250 } }));
    expect(res.status).toBe(403);
  });
});

describe('kahati downpayment setting', () => {
  it('returns the code-default downpayment (150) when unset', async () => {
    await signIn('admin');
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.kahatiDownpayment).toBe(150);
  });

  it('updates the downpayment and persists it', async () => {
    await signIn('admin');
    const res = await PATCH(patchReq({ kahatiDownpayment: 300 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.kahatiDownpayment).toBe(300);

    const after = await GET();
    expect((await after.json()).data.kahatiDownpayment).toBe(300);
  });

  it('leaves the downpayment untouched when only packing fees are patched', async () => {
    await signIn('admin');
    await PATCH(patchReq({ kahatiDownpayment: 300 }));
    const res = await PATCH(patchReq({ packingFees: { solo: 250 } }));
    const body = await res.json();
    expect(body.data.kahatiDownpayment).toBe(300);
    expect(body.data.packingFees.solo).toBe(250);
  });

  it('rejects a negative downpayment', async () => {
    await signIn('admin');
    const res = await PATCH(patchReq({ kahatiDownpayment: -1 }));
    expect(res.status).toBe(400);
  });
});
