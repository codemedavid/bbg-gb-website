// Integration tests for the MOQ product APIs — the admin CRUD shelf and the
// public, toggle-gated listing.
//
// Two guarantees matter most here. First, the admin shelf is scoped: it manages
// moq_products and nothing else, so the main catalog cannot be edited through
// it. Second, the visibility toggle is enforced server-side, not just in the UI
// — a customer who knows the URL must not be able to read MOQ products while
// the page is switched off.
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

const { GET: ADMIN_LIST, POST: ADMIN_CREATE } = await import('./route');
const { PATCH: ADMIN_PATCH, DELETE: ADMIN_DELETE } = await import('./[id]/route');
const { GET: PUBLIC_LIST } = await import('../../moq-products/route');
const { resetDb, makeMoqProduct, makeUser } = await import('@/lib/test/harness');
const { setMoqPageEnabled } = await import('@/lib/settings');
const { getDb, moqProducts, products } = await import('@/lib/db');
const { eq } = await import('drizzle-orm');

const asAdmin = () => { session.current = { sub: 'admin-id', role: 'admin', email: 'admin@bbg.test' }; };
const asCustomer = () => { session.current = { sub: 'cust-id', role: 'customer', email: 'c@bbg.test' }; };
const asAnon = () => { session.current = null; };

// The admin routes take multipart so an image can ride along with the fields.
function productForm(fields: Record<string, string>, image?: File): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (image) form.set('image', image);
  return new Request('http://localhost/api/admin/moq-products', { method: 'POST', body: form });
}

const pngFile = () => new File([Buffer.from('fake-png-bytes')], 'shot.png', { type: 'image/png' });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDb();
  asAdmin();
});

describe('POST /api/admin/moq-products', () => {
  it('creates an MOQ product with its price, stock and minimum order quantity', async () => {
    const res = await ADMIN_CREATE(productForm({
      name: 'FUAN GTT1500', spec: '1500mg', pricePhp: '4500', stock: '20', minOrderQty: '5',
      description: 'Bulk research peptide.',
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.name).toBe('FUAN GTT1500');
    expect(Number(body.data.pricePhp)).toBe(4500);
    expect(body.data.stock).toBe(20);
    expect(body.data.minOrderQty).toBe(5);
  });

  it('stores an uploaded image and returns a usable URL', async () => {
    const res = await ADMIN_CREATE(productForm(
      { name: 'TR30 + CGL5 Blends', spec: 'blend', pricePhp: '5200' },
      pngFile(),
    ));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.imageUrl).toBeTruthy();
  });

  it('creates a product with no image, leaving the URL null', async () => {
    const res = await ADMIN_CREATE(productForm({ name: 'TR20 + RT20 Blends', spec: 'blend', pricePhp: '5200' }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.imageUrl).toBeNull();
  });

  it('rejects a negative price', async () => {
    const res = await ADMIN_CREATE(productForm({ name: 'Bad Product', spec: 'x', pricePhp: '-1' }));
    expect(res.status).toBe(400);
  });

  it('rejects a minimum order quantity below 1', async () => {
    const res = await ADMIN_CREATE(productForm({ name: 'Bad Product', spec: 'x', pricePhp: '10', minOrderQty: '0' }));
    expect(res.status).toBe(400);
  });

  it('rejects a blank name', async () => {
    const res = await ADMIN_CREATE(productForm({ name: '', spec: 'x', pricePhp: '10' }));
    expect(res.status).toBe(400);
  });

  it('refuses a non-image upload', async () => {
    const bad = new File([Buffer.from('#!/bin/sh')], 'x.sh', { type: 'application/x-sh' });
    const res = await ADMIN_CREATE(productForm({ name: 'Shell', spec: 'x', pricePhp: '10' }, bad));
    expect(res.status).toBe(400);
  });

  it('rejects a customer', async () => {
    asCustomer();
    const res = await ADMIN_CREATE(productForm({ name: 'X', spec: 'x', pricePhp: '10' }));
    expect(res.status).toBe(403);
  });

  it('rejects an anonymous caller', async () => {
    asAnon();
    const res = await ADMIN_CREATE(productForm({ name: 'X', spec: 'x', pricePhp: '10' }));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/moq-products', () => {
  it('lists archived products too, so the admin sees the whole shelf', async () => {
    await makeMoqProduct({ name: 'Live', isActive: true });
    await makeMoqProduct({ name: 'Archived', isActive: false });

    const res = await ADMIN_LIST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.map((p: { name: string }) => p.name).sort()).toEqual(['Archived', 'Live']);
  });

  it('rejects a customer', async () => {
    asCustomer();
    expect((await ADMIN_LIST()).status).toBe(403);
  });
});

describe('PATCH /api/admin/moq-products/:id', () => {
  it('updates the fields the admin changed and leaves the rest alone', async () => {
    const p = await makeMoqProduct({ name: 'Old Name', pricePhp: 4500, stock: 10 });

    const req = new Request('http://localhost/x', {
      method: 'PATCH',
      body: (() => { const f = new FormData(); f.set('name', 'New Name'); f.set('stock', '99'); return f; })(),
    });
    const res = await ADMIN_PATCH(req, ctx(p.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe('New Name');
    expect(body.data.stock).toBe(99);
    expect(Number(body.data.pricePhp)).toBe(4500);
  });

  it('404s on an unknown product', async () => {
    const req = new Request('http://localhost/x', {
      method: 'PATCH',
      body: (() => { const f = new FormData(); f.set('name', 'Nope'); return f; })(),
    });
    const res = await ADMIN_PATCH(req, ctx('11111111-1111-1111-1111-111111111111'));
    expect(res.status).toBe(404);
  });

  it('rejects a customer', async () => {
    asCustomer();
    const p = { id: '11111111-1111-1111-1111-111111111111' };
    const req = new Request('http://localhost/x', {
      method: 'PATCH',
      body: (() => { const f = new FormData(); f.set('name', 'X'); return f; })(),
    });
    expect((await ADMIN_PATCH(req, ctx(p.id))).status).toBe(403);
  });
});

describe('DELETE /api/admin/moq-products/:id', () => {
  it('removes an unreferenced product outright', async () => {
    const p = await makeMoqProduct();
    const res = await ADMIN_DELETE(new Request('http://localhost/x', { method: 'DELETE' }), ctx(p.id));

    expect(res.status).toBe(200);
    const db = await getDb();
    expect(await db.select().from(moqProducts).where(eq(moqProducts.id, p.id))).toHaveLength(0);
  });

  it('404s on an unknown product', async () => {
    const res = await ADMIN_DELETE(
      new Request('http://localhost/x', { method: 'DELETE' }),
      ctx('11111111-1111-1111-1111-111111111111'),
    );
    expect(res.status).toBe(404);
  });

  it('rejects a customer', async () => {
    asCustomer();
    const res = await ADMIN_DELETE(
      new Request('http://localhost/x', { method: 'DELETE' }),
      ctx('11111111-1111-1111-1111-111111111111'),
    );
    expect(res.status).toBe(403);
  });
});

describe('admin MOQ shelf is scoped to moq_products', () => {
  it('never returns main-catalog products', async () => {
    const db = await getDb();
    await db.insert(products).values({ name: 'Catalog Peptide', spec: '10mg', pricePhp: '3200' });
    await makeMoqProduct({ name: 'Shelf Item' });

    const body = await (await ADMIN_LIST()).json();
    expect(body.data.map((p: { name: string }) => p.name)).toEqual(['Shelf Item']);
  });
});

describe('GET /api/moq-products (public, toggle-gated)', () => {
  it('404s while the MOQ page is switched off, even with a direct request', async () => {
    await makeMoqProduct({ name: 'Hidden' });
    asAnon();
    const res = await PUBLIC_LIST();
    expect(res.status).toBe(404);
  });

  it('404s for a signed-in customer too while the page is off', async () => {
    await makeMoqProduct({ name: 'Hidden' });
    asCustomer();
    expect((await PUBLIC_LIST()).status).toBe(404);
  });

  it('serves the shelf once the admin switches the page on', async () => {
    await makeMoqProduct({ name: 'FUAN GTT1500' });
    await setMoqPageEnabled(true);
    asAnon();

    const res = await PUBLIC_LIST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('FUAN GTT1500');
  });

  it('hides archived products from customers', async () => {
    await makeMoqProduct({ name: 'Live', isActive: true });
    await makeMoqProduct({ name: 'Archived', isActive: false });
    await setMoqPageEnabled(true);

    const body = await (await PUBLIC_LIST()).json();
    expect(body.data.map((p: { name: string }) => p.name)).toEqual(['Live']);
  });

  it('orders the shelf by the admin sort order', async () => {
    await makeMoqProduct({ name: 'Third', sortOrder: 3 });
    await makeMoqProduct({ name: 'First', sortOrder: 1 });
    await makeMoqProduct({ name: 'Second', sortOrder: 2 });
    await setMoqPageEnabled(true);

    const body = await (await PUBLIC_LIST()).json();
    expect(body.data.map((p: { name: string }) => p.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('goes dark again the moment the admin switches the page off', async () => {
    await makeMoqProduct({ name: 'FUAN GTT1500' });
    await setMoqPageEnabled(true);
    expect((await PUBLIC_LIST()).status).toBe(200);

    await setMoqPageEnabled(false);
    expect((await PUBLIC_LIST()).status).toBe(404);
  });
});
