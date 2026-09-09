// Integration tests for the COA gallery APIs — the admin upload and the public
// list the storefront reads.
//
// The guarantee this file exists for is WHERE the file is served from. A COA is
// the document that says the batch was third-party tested, so the customer is
// being asked to trust it; a link that lands on ik.imagekit.io is a link that no
// longer looks like it came from BBG. Production runs the ImageKit driver, whose
// signedUrl() hands back exactly that host, so every URL this feature returns is
// asserted to be one of this site's own /api/files paths instead — and asserted
// to carry no scheme and no host at all, because "not imagekit" would still pass
// for the next storage backend somebody wires in.
//
// The second guarantee is that a logged-OUT visitor can read the list. A COA
// behind a login is useless: the people who most need to see the lab result are
// the ones deciding whether to join a batch at all.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const getSession = async () => session.current;
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError,
    getSession,
    requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST: UPLOAD } = await import('./route');
const { DELETE: REMOVE } = await import('./[id]/route');
const { GET: PUBLIC_LIST } = await import('../../coa/route');

const { resetDb, makeProduct } = await import('@/lib/test/harness');
const { getDb, coaFiles } = await import('@/lib/db');
const { eq } = await import('drizzle-orm');

const asAdmin = () => { session.current = { sub: 'admin-id', role: 'admin', email: 'admin@bbg.test' }; };
const asCustomer = () => { session.current = { sub: 'cust-id', role: 'customer', email: 'c@bbg.test' }; };
const asAnon = () => { session.current = null; };

const imageFile = (name = 'coa.png', type = 'image/png') =>
  new File([Buffer.from('fake-png-bytes')], name, { type });

// Multipart, so the certificate rides along with the batch label.
const uploadReq = (fields: Record<string, string> = {}, file?: File | null) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set('file', file);
  return new Request('http://localhost/api/admin/coa', { method: 'POST', body: form });
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

type Body = { success: boolean; data: any; error: string | null };
const body = async (res: Response) => (await res.json()) as Body;

const upload = async (fields: Record<string, string> = {}, file: File | null = imageFile()) =>
  body(await UPLOAD(uploadReq(fields, file)));

const list = async () => (await body(await PUBLIC_LIST())).data as any[];

beforeEach(async () => {
  await resetDb();
  asAdmin();
});

describe('POST /api/admin/coa', () => {
  it('stores the uploaded certificate and returns it under this site\'s own URL', async () => {
    const { data } = await upload({ label: 'Retatrutide 10mg', batch: 'A24' });

    // The path this site serves, and NOTHING else: no scheme, no host, so the
    // browser cannot be sent anywhere but bbgph.org.
    expect(data.fileUrl).toMatch(/^\/api\/files\/coa-files\/[0-9a-f-]{36}\.png$/);
    expect(data.fileUrl).not.toMatch(/:\/\//);
    expect(data.label).toBe('Retatrutide 10mg');
    expect(data.batch).toBe('A24');
    expect(data.isImage).toBe(true);

    // The row is real, and the storage key is what the URL was built from.
    const db = await getDb();
    const [row] = await db.select().from(coaFiles).where(eq(coaFiles.id, data.id));
    expect(row.fileName).toBe('Retatrutide 10mg');
    expect(data.fileUrl).toContain(row.storageKey);
  });

  it('falls back to the uploaded file name when the admin types no label', async () => {
    const { data } = await upload({}, imageFile('reta-batch-a24.png'));

    expect(data.label).toBe('reta-batch-a24.png');
  });

  it('files the certificate against a product, and reports that product by name', async () => {
    const product = await makeProduct({ name: 'Retatrutide 10mg' });

    const { data } = await upload({ productId: product.id, batch: 'A24' });

    expect(data.productId).toBe(product.id);
    expect(data.productName).toBe('Retatrutide 10mg');
  });

  it('refuses a product that no longer exists instead of failing on the foreign key', async () => {
    const res = await UPLOAD(uploadReq({ productId: '11111111-1111-1111-1111-111111111111' }, imageFile()));

    expect(res.status).toBe(404);
    expect((await body(res)).error).toMatch(/product/i);
  });

  it('requires a file — a COA row with no document is not a COA', async () => {
    const res = await UPLOAD(uploadReq({ label: 'Retatrutide 10mg' }, null));

    expect(res.status).toBe(400);
    expect(await list()).toHaveLength(0);
  });

  it('rejects a file that is not an image', async () => {
    const res = await UPLOAD(uploadReq({}, new File([Buffer.from('hi')], 'notes.txt', { type: 'text/plain' })));

    expect(res.status).toBe(400);
  });

  it('is closed to customers and to anonymous visitors', async () => {
    asCustomer();
    expect((await UPLOAD(uploadReq({}, imageFile()))).status).toBe(403);

    asAnon();
    expect((await UPLOAD(uploadReq({}, imageFile()))).status).toBe(401);
  });
});

describe('GET /api/coa', () => {
  it('lists the certificates to a logged-out visitor', async () => {
    await upload({ label: 'Retatrutide 10mg', batch: 'A24' });
    asAnon();

    const rows = await list();

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Retatrutide 10mg');
    expect(rows[0].fileUrl).toMatch(/^\/api\/files\/coa-files\//);
  });

  it('puts the newest batch first — that is the one people are deciding about', async () => {
    await upload({ label: 'Older batch' });
    await upload({ label: 'Newer batch' });

    expect((await list()).map((r) => r.label)).toEqual(['Newer batch', 'Older batch']);
  });

  it('serves a legacy PDF certificate from this site too, flagged as not an image', async () => {
    const db = await getDb();
    await db.insert(coaFiles).values({ fileName: 'RETA-A24.pdf', storageKey: 'legacy/reta-a24.pdf', batch: 'A24' });

    const [row] = await list();

    expect(row.isImage).toBe(false);
    expect(row.fileUrl).toBe('/api/files/coa-files/legacy/reta-a24.pdf');
  });

  it('never exposes the storage key as a field a client could send to the CDN', async () => {
    await upload({ label: 'Retatrutide 10mg' });

    expect(Object.keys((await list())[0])).not.toContain('storageKey');
  });
});

describe('DELETE /api/admin/coa/:id', () => {
  it('removes a certificate uploaded by mistake', async () => {
    const { data } = await upload({ label: 'Wrong file' });

    const res = await REMOVE(new Request('http://localhost', { method: 'DELETE' }), ctx(data.id));

    expect(res.status).toBe(200);
    expect(await list()).toHaveLength(0);
  });

  it('reports an unknown certificate as missing', async () => {
    const res = await REMOVE(
      new Request('http://localhost', { method: 'DELETE' }),
      ctx('11111111-1111-1111-1111-111111111111'),
    );

    expect(res.status).toBe(404);
  });

  it('is closed to customers', async () => {
    const { data } = await upload({ label: 'Retatrutide 10mg' });
    asCustomer();

    const res = await REMOVE(new Request('http://localhost', { method: 'DELETE' }), ctx(data.id));

    expect(res.status).toBe(403);
    expect(await (async () => { asAnon(); return list(); })()).toHaveLength(1);
  });
});
