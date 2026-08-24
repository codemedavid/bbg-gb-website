// A payment method's PURPOSE, end to end.
//
// The separation is what makes "the regular QR must not appear while the kit is
// incomplete" an invariant rather than a rule the checkout has to remember: the
// downpayment screen selects on this column, so there is nothing else in the
// list it could render by mistake.
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

const { POST } = await import('./route');
const { PATCH } = await import('./[id]/route');
const { GET: PUBLIC_GET } = await import('@/app/api/payment-methods/route');
const { resetDb, makeUser } = await import('@/lib/test/harness');

async function signInAdmin() {
  const user = await makeUser({ role: 'admin' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

function methodForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set('qr', new File([Buffer.from('fake-qr')], 'qr.png', { type: 'image/png' }));
  return form;
}

const create = async (fields: Record<string, string>) => {
  const res = await POST(new Request('http://localhost/api/admin/payment-methods', { method: 'POST', body: methodForm(fields) }));
  return { status: res.status, body: await res.json() };
};

const BASE = { label: 'GCash', accountName: 'BBG Peptides', accountNumber: '0917-000-0000' };

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('creating a payment method', () => {
  it('defaults to a full-payment method when no purpose is sent', async () => {
    // Arrange — an older client that does not know the field exists.
    await signInAdmin();
    // Act
    const { status, body } = await create(BASE);
    // Assert — it must never become a downpayment method by omission.
    expect(status).toBe(201);
    expect(body.data.purpose).toBe('full');
  });

  it('stores a kahati downpayment method with its instructions', async () => {
    await signInAdmin();

    const { body } = await create({
      ...BASE, label: 'GCash DP', purpose: 'kahati_downpayment',
      instructions: 'Send exactly the downpayment amount.',
    });

    expect(body.data.purpose).toBe('kahati_downpayment');
    expect(body.data.instructions).toBe('Send exactly the downpayment amount.');
  });

  it('refuses a purpose it does not recognise', async () => {
    await signInAdmin();
    const { status } = await create({ ...BASE, purpose: 'bananas' });
    expect(status).toBe(400);
  });
});

describe('editing a payment method', () => {
  it('moves a method between the two lists', async () => {
    await signInAdmin();
    const { body } = await create(BASE);

    const form = methodForm({ ...BASE, purpose: 'kahati_downpayment' });
    const res = await PATCH(
      new Request(`http://localhost/api/admin/payment-methods/${body.data.id}`, { method: 'PATCH', body: form }),
      { params: Promise.resolve({ id: body.data.id }) },
    );
    const updated = await res.json();

    expect(updated.data.purpose).toBe('kahati_downpayment');
  });

  it('does not demote a downpayment method on a PATCH that omits the purpose', async () => {
    // Arrange — the downpayment QR customers pay their deposit to.
    await signInAdmin();
    const { body } = await create({ ...BASE, label: 'GCash DP', purpose: 'kahati_downpayment' });

    // Act — an edit that changes only the account number, sending no purpose.
    const form = methodForm({ label: 'GCash DP', accountName: BASE.accountName, accountNumber: '0917-111-1111' });
    const res = await PATCH(
      new Request(`http://localhost/api/admin/payment-methods/${body.data.id}`, { method: 'PATCH', body: form }),
      { params: Promise.resolve({ id: body.data.id }) },
    );

    // Assert — silently turning it into a full-payment method would both block
    // hatian checkout and put this QR in the list customers tap to pay in full.
    expect((await res.json()).data.purpose).toBe('kahati_downpayment');
  });

  it('keeps the instructions on a PATCH that omits the field', async () => {
    await signInAdmin();
    const { body } = await create({ ...BASE, instructions: 'Reference required.' });

    const form = methodForm({ label: BASE.label, accountName: BASE.accountName, accountNumber: '0917-222-2222' });
    const res = await PATCH(
      new Request(`http://localhost/api/admin/payment-methods/${body.data.id}`, { method: 'PATCH', body: form }),
      { params: Promise.resolve({ id: body.data.id }) },
    );

    expect((await res.json()).data.instructions).toBe('Reference required.');
  });

  it('clears the instructions when the field is submitted empty', async () => {
    await signInAdmin();
    const { body } = await create({ ...BASE, instructions: 'Reference required.' });

    const form = methodForm({ ...BASE, instructions: '' });
    const res = await PATCH(
      new Request(`http://localhost/api/admin/payment-methods/${body.data.id}`, { method: 'PATCH', body: form }),
      { params: Promise.resolve({ id: body.data.id }) },
    );

    expect((await res.json()).data.instructions).toBeNull();
  });
});

describe('the public checkout list', () => {
  it('tells the two kinds apart, so the checkout can render only one of them', async () => {
    await signInAdmin();
    await create(BASE);
    await create({ ...BASE, label: 'GCash DP', purpose: 'kahati_downpayment' });
    session.current = null; // the storefront is anonymous

    const body = await (await PUBLIC_GET()).json();

    const byLabel = Object.fromEntries(body.data.map((m: { label: string; purpose: string }) => [m.label, m.purpose]));
    expect(byLabel).toEqual({ GCash: 'full', 'GCash DP': 'kahati_downpayment' });
  });
});
