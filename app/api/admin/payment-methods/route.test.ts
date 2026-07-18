// Integration tests for the admin payment-methods CRUD + QR upload.
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

const { GET, POST } = await import('./route');
const { PATCH } = await import('./[id]/route');
const { resetDb, makeUser } = await import('@/lib/test/harness');

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

function methodForm(fields: Record<string, string>, withQr = true): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (withQr) form.set('qr', new File([Buffer.from('fake-qr')], 'qr.png', { type: 'image/png' }));
  return form;
}

function req(form: FormData): Request {
  return new Request('http://localhost/api/admin/payment-methods', { method: 'POST', body: form });
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('admin payment methods', () => {
  it('rejects non-admins', async () => {
    await signIn('customer');
    const res = await POST(req(methodForm({ label: 'GCash', accountName: 'BBG', accountNumber: '0917' })));
    expect(res.status).toBe(403);
  });

  it('creates a method with an uploaded QR and returns a qrUrl', async () => {
    await signIn();
    const res = await POST(req(methodForm({ label: 'GCash', accountName: 'BBG Peptides', accountNumber: '09171234567' })));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({ label: 'GCash', accountName: 'BBG Peptides' });
    expect(body.data.qrUrl).toBeTruthy();
  });

  it('validates required fields', async () => {
    await signIn();
    const res = await POST(req(methodForm({ label: '', accountName: 'BBG', accountNumber: '0917' })));
    expect(res.status).toBe(400);
  });

  it('lists created methods', async () => {
    await signIn();
    await POST(req(methodForm({ label: 'Maya', accountName: 'BBG', accountNumber: '0917' })));
    const res = await GET();
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].label).toBe('Maya');
  });

  it('keeps the existing QR when a PATCH sends no new file', async () => {
    await signIn();
    const created = await (await POST(req(methodForm({ label: 'GCash', accountName: 'BBG', accountNumber: '0917' })))).json();
    const id = created.data.id;

    const patchForm = methodForm({ label: 'GCash', accountName: 'BBG Updated', accountNumber: '0917' }, false);
    const patchReq = new Request(`http://localhost/api/admin/payment-methods/${id}`, { method: 'PATCH', body: patchForm });
    const res = await PATCH(patchReq, { params: Promise.resolve({ id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.accountName).toBe('BBG Updated');
    expect(body.data.qrUrl).toBeTruthy(); // preserved
  });
});
