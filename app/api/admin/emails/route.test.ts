// Admin → Emails: the only place the delivery of a notification can be seen.
//
// There is no Vercel log access for this project, so `console.error` is written
// to nobody. Between 2026-08-17 and 2026-08-31 that meant 144 undelivered
// password resets produced no signal anywhere a human would look, and the
// outage was found only when customers said so. This route is the signal.
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

const { GET } = await import('./route');
const { resetDb } = await import('@/lib/test/harness');
const { getDb, emailLog } = await import('@/lib/db');

type Row = {
  toEmail: string; subject: string; body: string; kind: string;
  deliveredBy: string; status: string; error?: string | null;
};

const log = async (row: Partial<Row> & { kind: string; status: string }) => {
  const db = await getDb();
  await db.insert(emailLog).values({
    toEmail: row.toEmail ?? 'ana@bbg.test',
    subject: row.subject ?? 'Reset your BBG Peptides password',
    body: row.body ?? '<p>link</p>',
    kind: row.kind,
    deliveredBy: row.deliveredBy ?? 'posthog',
    status: row.status,
    error: row.error ?? null,
  });
};

const req = (query = '') => new Request(`http://localhost/api/admin/emails${query}`);
const body = async (res: Response) => (await res.json()).data;

beforeEach(async () => {
  await resetDb();
  session.current = { sub: 'admin-1', role: 'admin', email: 'admin@bbg.test' };
});

describe('GET /api/admin/emails', () => {
  it('returns the delivery status of each notification', async () => {
    await log({ kind: 'password_reset', status: 'sent' });

    const rows = await body(await GET(req()));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'password_reset', status: 'sent', deliveredBy: 'posthog', toEmail: 'ana@bbg.test',
    });
  });

  // The question an admin actually arrives with: "did anything fail?"
  it('filters to the failures alone', async () => {
    await log({ kind: 'password_reset', status: 'sent' });
    await log({ kind: 'password_reset', status: 'failed', error: 'network down' });
    await log({ kind: 'order_receipt', status: 'skipped' });

    const rows = await body(await GET(req('?status=failed')));

    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBe('network down');
  });

  it('filters by kind so the reset flow can be read on its own', async () => {
    await log({ kind: 'password_reset', status: 'sent' });
    await log({ kind: 'order_receipt', status: 'queued' });

    const rows = await body(await GET(req('?kind=password_reset')));

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('password_reset');
  });

  it('finds every notification sent to one address', async () => {
    await log({ kind: 'password_reset', status: 'sent', toEmail: 'ana@bbg.test' });
    await log({ kind: 'password_reset', status: 'sent', toEmail: 'ben@bbg.test' });

    const rows = await body(await GET(req('?search=ben@bbg')));

    expect(rows).toHaveLength(1);
    expect(rows[0].toEmail).toBe('ben@bbg.test');
  });

  it('puts the newest first — an outage is read from the top', async () => {
    await log({ kind: 'password_reset', status: 'sent', subject: 'older' });
    await new Promise((r) => setTimeout(r, 5));
    await log({ kind: 'password_reset', status: 'failed', subject: 'newer' });

    const rows = await body(await GET(req()));

    expect(rows[0].subject).toBe('newer');
  });

  // The body is the rendered HTML of a mail that carries a single-use reset
  // credential. The list must not hand those out; the row is metadata only.
  it('never returns the message body, which for a reset contains a live token', async () => {
    await log({ kind: 'password_reset', status: 'sent', body: '<a href="https://x/reset-password?token=SECRET">' });

    const rows = await body(await GET(req()));

    expect(JSON.stringify(rows)).not.toContain('SECRET');
  });

  it('refuses a customer', async () => {
    session.current = { sub: 'u1', role: 'customer', email: 'ana@bbg.test' };

    expect((await GET(req())).status).toBe(403);
  });

  it('refuses a signed-out caller', async () => {
    session.current = null;

    expect((await GET(req())).status).toBe(401);
  });
});
