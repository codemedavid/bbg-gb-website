// The admin form -> admin API contract.
//
// Same class of seam that broke MOQ checkout: the admin screen builds a
// multipart body and the route parses it, and until now both sides were only
// ever tested against their own restatement of the payload. A renamed field or a
// value the parser reads differently would pass both suites and fail silently in
// production — a PATCH that quietly drops a field does not error, it just does
// not save.
//
// These tests build the body with the production helper the admin page itself
// uses, then hand it to the real route handlers.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  return {
    ApiError,
    getSession: async () => ({ sub: 'admin', role: 'admin', email: 'a@b.c' }),
    requireSession: async () => ({ sub: 'admin', role: 'admin', email: 'a@b.c' }),
    requireAdmin: async () => ({ sub: 'admin', role: 'admin', email: 'a@b.c' }),
  };
});

const { POST } = await import('./route');
const { PATCH } = await import('./[id]/route');
const { moqProductFormData, emptyMoqDraft, moqDraftFrom } = await import('@/lib/moq-product-form');
const { getDb, moqProducts } = await import('@/lib/db');
const { resetDb, makeMoqProduct } = await import('@/lib/test/harness');

const req = (body: FormData, method: string) =>
  new Request('http://localhost/api/admin/moq-products', { method, body });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const rowOf = async (id: string) => {
  const [row] = await (await getDb()).select().from(moqProducts).where(eq(moqProducts.id, id));
  return row;
};

beforeEach(resetDb);

describe('what the admin create form sends is what the API stores', () => {
  it('round-trips every field the form collects', async () => {
    const body = moqProductFormData({
      ...emptyMoqDraft,
      name: 'FUAN GTT1500', spec: '1500mg', description: 'Bulk peptide.',
      pricePhp: '4500', stock: '40', minOrderQty: '5',
      packingFeePhp: '450', imageEmoji: '🧪', sortOrder: '2', isActive: true,
    }, null);

    const res = await POST(req(body, 'POST'));
    const created = await res.json();
    expect(res.status).toBe(201);

    const row = await rowOf(created.data.id);
    expect(row.name).toBe('FUAN GTT1500');
    expect(row.spec).toBe('1500mg');
    expect(row.description).toBe('Bulk peptide.');
    expect(Number(row.pricePhp)).toBe(4500);
    expect(row.stock).toBe(40);
    expect(row.minOrderQty).toBe(5);
    expect(Number(row.packingFeePhp)).toBe(450);
    expect(row.imageEmoji).toBe('🧪');
    expect(row.sortOrder).toBe(2);
    expect(row.isActive).toBe(true);
  });

  it('stores no packing fee when the admin leaves it blank', async () => {
    const body = moqProductFormData({ ...emptyMoqDraft, name: 'No Fee', pricePhp: '100' }, null);
    const created = await (await POST(req(body, 'POST'))).json();
    // null, not 0 — 0 would price the packing fee as genuinely free.
    expect((await rowOf(created.data.id)).packingFeePhp).toBeNull();
  });

  it('creates an archived product when visibility is unticked', async () => {
    const body = moqProductFormData({ ...emptyMoqDraft, name: 'Hidden', pricePhp: '100', isActive: false }, null);
    const created = await (await POST(req(body, 'POST'))).json();
    expect((await rowOf(created.data.id)).isActive).toBe(false);
  });

  it('carries an attached image through to storage', async () => {
    const image = new File([Buffer.from('png-bytes')], 'shot.png', { type: 'image/png' });
    const body = moqProductFormData({ ...emptyMoqDraft, name: 'With Image', pricePhp: '100' }, image);
    const created = await (await POST(req(body, 'POST'))).json();
    expect((await rowOf(created.data.id)).imageKey).toBeTruthy();
  });
});

describe('what the admin edit form sends is what the API updates', () => {
  it('round-trips an edit built from the existing product', async () => {
    const p = await makeMoqProduct({ name: 'Old', pricePhp: 4500, stock: 40, minOrderQty: 5 });
    const existing = await rowOf(p.id);

    // The form prefills from the product, the admin changes two fields.
    const draft = { ...moqDraftFrom({ ...existing, imageUrl: null, inStock: true }), name: 'New', stock: '99' };
    const res = await PATCH(req(moqProductFormData(draft, null), 'PATCH'), ctx(p.id));
    expect(res.status).toBe(200);

    const row = await rowOf(p.id);
    expect(row.name).toBe('New');
    expect(row.stock).toBe(99);
    // Untouched fields must survive the round trip.
    expect(Number(row.pricePhp)).toBe(4500);
    expect(row.minOrderQty).toBe(5);
  });

  it('preserves an existing packing fee across an edit that does not change it', async () => {
    const p = await makeMoqProduct({ packingFeePhp: 450 });
    const existing = await rowOf(p.id);

    const draft = moqDraftFrom({ ...existing, imageUrl: null, inStock: true });
    await PATCH(req(moqProductFormData(draft, null), 'PATCH'), ctx(p.id));

    expect(Number((await rowOf(p.id)).packingFeePhp)).toBe(450);
  });

  it('keeps the existing image when the admin uploads no replacement', async () => {
    const p = await makeMoqProduct({ imageKey: 'original.png' });
    const existing = await rowOf(p.id);

    const draft = moqDraftFrom({ ...existing, imageUrl: null, inStock: true });
    await PATCH(req(moqProductFormData(draft, null), 'PATCH'), ctx(p.id));

    expect((await rowOf(p.id)).imageKey).toBe('original.png');
  });

  it('replaces the image when the admin uploads a new one', async () => {
    const p = await makeMoqProduct({ imageKey: 'original.png' });
    const existing = await rowOf(p.id);

    const draft = moqDraftFrom({ ...existing, imageUrl: null, inStock: true });
    const image = new File([Buffer.from('new-bytes')], 'new.png', { type: 'image/png' });
    await PATCH(req(moqProductFormData(draft, image), 'PATCH'), ctx(p.id));

    const row = await rowOf(p.id);
    expect(row.imageKey).toBeTruthy();
    expect(row.imageKey).not.toBe('original.png');
  });

  it('archives a product by unticking visibility', async () => {
    const p = await makeMoqProduct({ isActive: true });
    const existing = await rowOf(p.id);

    const draft = { ...moqDraftFrom({ ...existing, imageUrl: null, inStock: true }), isActive: false };
    await PATCH(req(moqProductFormData(draft, null), 'PATCH'), ctx(p.id));

    expect((await rowOf(p.id)).isActive).toBe(false);
  });
});
