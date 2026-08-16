// Closing a filled round and opening the next.
//
// The shelf runs the same item again and again: the admin places the buy with
// the supplier, then starts collecting for the next round. That reset is the
// only thing that moves a shelf item on, so it must do two things exactly — put
// the counter back to zero, and advance the cycle number so the orders from the
// round just closed keep reading as placed rather than falling back to waiting.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const session = { current: { sub: 'admin', role: 'admin', email: 'a@b.c' } as { sub: string; role: string; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  return {
    ApiError,
    getSession: async () => session.current,
    requireSession: async () => {
      if (!session.current) throw new ApiError(401, 'Authentication required.');
      return session.current;
    },
    requireAdmin: async () => {
      if (session.current?.role !== 'admin') throw new ApiError(403, 'Admin only.');
      return session.current;
    },
  };
});

const { POST } = await import('./route');
const { getDb, moqProducts } = await import('@/lib/db');
const { resetDb, makeMoqProduct } = await import('@/lib/test/harness');

const req = () => new Request('http://localhost/x', { method: 'POST' });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const rowOf = async (id: string) => {
  const [row] = await (await getDb()).select().from(moqProducts).where(eq(moqProducts.id, id));
  return row;
};

beforeEach(async () => {
  session.current = { sub: 'admin', role: 'admin', email: 'a@b.c' };
  await resetDb();
});

describe('POST /api/admin/moq-products/:id/cycle', () => {
  it('puts the counter back to zero for the next round', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 500 });

    const res = await POST(req(), ctx(p.id));
    expect(res.status).toBe(200);

    expect((await rowOf(p.id)).committed).toBe(0);
  });

  it('advances the cycle number so closed rounds stay distinguishable', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 500, cycleNo: 1 });

    await POST(req(), ctx(p.id));

    expect((await rowOf(p.id)).cycleNo).toBe(2);
  });

  it('leaves the target itself alone — the next round has the same goal', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 500 });

    await POST(req(), ctx(p.id));

    expect((await rowOf(p.id)).moq).toBe(500);
  });

  // The admin placed the buy anyway. Recording that has to be possible, or the
  // shelf item is stuck on a round that will never fill.
  it('closes a round that never reached its target', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 12 });

    const res = await POST(req(), ctx(p.id));

    expect(res.status).toBe(200);
    expect((await rowOf(p.id)).committed).toBe(0);
    expect((await rowOf(p.id)).cycleNo).toBe(2);
  });

  // Two admins clicking at the same moment must advance the round once, not
  // twice — skipping a cycle number would strand the orders that recorded it.
  it('advances exactly one round when clicked twice concurrently', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 500, cycleNo: 1 });

    await Promise.all([POST(req(), ctx(p.id)), POST(req(), ctx(p.id))]);

    expect((await rowOf(p.id)).cycleNo).toBe(2);
  });

  it('returns the shelf item as the admin screen reads it', async () => {
    const p = await makeMoqProduct({ moq: 500, committed: 500 });

    const body = await (await POST(req(), ctx(p.id))).json();

    expect(body.data).toMatchObject({ committed: 0, moq: 500, cycleNo: 2, reached: false, remaining: 500 });
  });

  it('404s on an unknown product', async () => {
    const res = await POST(req(), ctx('11111111-1111-1111-1111-111111111111'));
    expect(res.status).toBe(404);
  });

  it('rejects a customer', async () => {
    const p = await makeMoqProduct();
    session.current = { sub: 'u1', role: 'customer', email: 'c@b.c' };

    const res = await POST(req(), ctx(p.id));
    expect(res.status).toBe(403);
    expect((await rowOf(p.id)).cycleNo).toBe(1);
  });
});
