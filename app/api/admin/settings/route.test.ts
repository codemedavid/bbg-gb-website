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
  it('returns the code-default packing fees when unset (200/150/300/200)', async () => {
    await signIn('admin');
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.packingFees).toEqual({ solo: 200, kahati: 150, group_buy: 300, moq: 200 });
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

  it('saves a kahati downpayment policy and reads it back', async () => {
    await signIn('admin');
    const res = await PATCH(patchReq({
      kahatiDownpayment: { mode: 'fixed', amountPhp: 500, percent: 0, refundable: false, policyNote: 'Non-refundable.' },
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.kahatiDownpayment).toEqual({
      mode: 'fixed', amountPhp: 500, percent: 0, refundable: false, policyNote: 'Non-refundable.',
    });
  });

  it('rejects a zero fixed downpayment as a 400 the form can render', async () => {
    // Not a 500. The admin has to be told what to type instead, and a generic
    // "Something went wrong" tells them only that the save failed.
    await signIn('admin');
    const res = await PATCH(patchReq({
      kahatiDownpayment: { mode: 'fixed', amountPhp: 0, percent: 0, refundable: true, policyNote: null },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/more than zero/i);
  });

  it('rejects a zero percent downpayment as a 400', async () => {
    await signIn('admin');
    const res = await PATCH(patchReq({
      kahatiDownpayment: { mode: 'percent', amountPhp: 0, percent: 0, refundable: true, policyNote: null },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/percent/i);
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

