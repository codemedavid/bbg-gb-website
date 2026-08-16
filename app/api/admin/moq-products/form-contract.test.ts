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
const { moqProductStatus } = await import('@/lib/moq-product-cycle');
type MoqProduct = import('@/lib/types').MoqProduct;

const req = (body: FormData, method: string) =>
  new Request('http://localhost/api/admin/moq-products', { method, body });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const rowOf = async (id: string) => {
  const [row] = await (await getDb()).select().from(moqProducts).where(eq(moqProducts.id, id));
  return row;
};

// The stored row as the admin screen receives it, so an edit draft is built from
// the same shape the real form prefills from.
const serialized = (row: Awaited<ReturnType<typeof rowOf>>): MoqProduct => ({
  ...row, imageUrl: null,
  ...moqProductStatus(row.committed, row.moq),
});

beforeEach(resetDb);

describe('what the admin create form sends is what the API stores', () => {
  it('round-trips every field the form collects', async () => {
    const body = moqProductFormData({
      ...emptyMoqDraft,
      name: 'FUAN GTT1500', spec: '1500mg', description: 'Bulk peptide.',
      pricePhp: '4500', moq: '500',
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
    expect(row.moq).toBe(500);
    // A brand new buy has nothing committed and is on its first round.
    expect(row.committed).toBe(0);
    expect(row.cycleNo).toBe(1);
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
    const p = await makeMoqProduct({ name: 'Old', pricePhp: 4500, moq: 500, committed: 120 });
    const existing = await rowOf(p.id);

    // The form prefills from the product, the admin changes two fields.
    const draft = { ...moqDraftFrom(serialized(existing)), name: 'New', moq: '900' };
    const res = await PATCH(req(moqProductFormData(draft, null), 'PATCH'), ctx(p.id));
    expect(res.status).toBe(200);

    const row = await rowOf(p.id);
    expect(row.name).toBe('New');
    expect(row.moq).toBe(900);
    // Untouched fields must survive the round trip.
    expect(Number(row.pricePhp)).toBe(4500);
    // Raising the target must not disturb what buyers have already committed.
    expect(row.committed).toBe(120);
  });

  it('preserves an existing packing fee across an edit that does not change it', async () => {
    const p = await makeMoqProduct({ packingFeePhp: 450 });
    const existing = await rowOf(p.id);

    const draft = moqDraftFrom(serialized(existing));
    await PATCH(req(moqProductFormData(draft, null), 'PATCH'), ctx(p.id));

    expect(Number((await rowOf(p.id)).packingFeePhp)).toBe(450);
  });

  it('keeps the existing image when the admin uploads no replacement', async () => {
    const p = await makeMoqProduct({ imageKey: 'original.png' });
    const existing = await rowOf(p.id);

    const draft = moqDraftFrom(serialized(existing));
    await PATCH(req(moqProductFormData(draft, null), 'PATCH'), ctx(p.id));

    expect((await rowOf(p.id)).imageKey).toBe('original.png');
  });

  it('replaces the image when the admin uploads a new one', async () => {
    const p = await makeMoqProduct({ imageKey: 'original.png' });
    const existing = await rowOf(p.id);

    const draft = moqDraftFrom(serialized(existing));
    const image = new File([Buffer.from('new-bytes')], 'new.png', { type: 'image/png' });
    await PATCH(req(moqProductFormData(draft, image), 'PATCH'), ctx(p.id));

    const row = await rowOf(p.id);
    expect(row.imageKey).toBeTruthy();
    expect(row.imageKey).not.toBe('original.png');
  });

  it('archives a product by unticking visibility', async () => {
    const p = await makeMoqProduct({ isActive: true });
    const existing = await rowOf(p.id);

    const draft = { ...moqDraftFrom(serialized(existing)), isActive: false };
    await PATCH(req(moqProductFormData(draft, null), 'PATCH'), ctx(p.id));

    expect((await rowOf(p.id)).isActive).toBe(false);
  });
});
