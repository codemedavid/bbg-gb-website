// The catalog's group buy configuration, end to end.
//
// The client's rule is that these five settings "belong to the product and will
// automatically be used whenever that product is included in a Group Buy
// campaign". lib/pricing.ts already implements the "automatically used" half and
// lib/db/schema.ts has the columns — but nothing wrote them, so every seeded
// listing fell back to the global defaults no matter what an admin typed.
//
// These tests run against a real database because the failure mode is a column
// that silently never fills: a mocked db would happily echo back whatever the
// route claimed to have saved.
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
const { resetDb, makeUser } = await import('@/lib/test/harness');
const { groupBuyUnitPrice, kahatiDefaultsFor, campaignDefaultsFor } = await import('@/lib/pricing');

const BASE = { name: 'Retatrutide', spec: '10mg', pricePhp: 3200 };

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function signInAdmin() {
  const user = await makeUser({ role: 'admin' });
  session.current = { sub: user.id, role: user.role, email: user.email };
}

async function create(body: Record<string, unknown>) {
  const res = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }));
  const json = await res.json();
  if (res.status !== 201) throw new Error(`create failed (${res.status}): ${json.error}`);
  return json.data;
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await PATCH(
    new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }),
    ctx(id),
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  await resetDb();
  session.current = null;
  await signInAdmin();
});

describe('admin products — group buy configuration', () => {
  it('stores every group buy setting the edit form sends', async () => {
    const row = await create({
      ...BASE,
      isGroupBuy: true,
      gbPricePerKitPhp: 4500,
      gbPricePerPiecePhp: 480,
      gbVialsPerKit: 10,
      gbMinVials: 2,
      gbMaxVialsPerBatch: 10,
    });

    expect(row.isGroupBuy).toBe(true);
    // Money lands in numeric columns, which Drizzle hands back as strings —
    // asserted as numbers so a column that quietly stayed null cannot pass.
    expect(Number(row.gbPricePerKitPhp)).toBe(4500);
    expect(Number(row.gbPricePerPiecePhp)).toBe(480);
    expect(row.gbVialsPerKit).toBe(10);
    expect(row.gbMinVials).toBe(2);
    expect(row.gbMaxVialsPerBatch).toBe(10);
  });

  it('leaves the group buy columns empty for a product sold the ordinary way', async () => {
    const row = await create(BASE);

    expect(row.isGroupBuy).toBe(false);
    expect(row.gbPricePerKitPhp).toBeNull();
    expect(row.gbVialsPerKit).toBeNull();
    expect(row.gbMaxVialsPerBatch).toBeNull();
  });

  it('updates a single group buy setting without disturbing the rest', async () => {
    const row = await create({
      ...BASE, isGroupBuy: true, gbPricePerKitPhp: 4500, gbVialsPerKit: 10, gbMinVials: 2,
    });

    const { status, body } = await patch(row.id, { gbPricePerKitPhp: 5200 });

    expect(status).toBe(200);
    expect(Number(body.data.gbPricePerKitPhp)).toBe(5200);
    expect(body.data.gbVialsPerKit).toBe(10);
    expect(body.data.gbMinVials).toBe(2);
  });

  it('clears a setting the admin blanked instead of storing zero', async () => {
    const row = await create({ ...BASE, isGroupBuy: true, gbPricePerKitPhp: 4500, gbMinVials: 4 });

    const { body } = await patch(row.id, { gbMinVials: null });

    // Null is "no minimum of its own", which seeds KAHATI_MIN_VIALS. A stored 0
    // would be a different thing entirely — and an invalid one.
    expect(body.data.gbMinVials).toBeNull();
  });

  it('refuses a group buy price below zero', async () => {
    const { status } = await patch((await create(BASE)).id, { gbPricePerKitPhp: -1 });

    expect(status).toBe(400);
  });

  it('refuses a kit that holds no vials', async () => {
    const { status } = await patch((await create(BASE)).id, { gbVialsPerKit: 0 });

    expect(status).toBe(400);
  });

  // The point of storing any of this: a listing built from the product must
  // start at the product's own terms, not at the global fallbacks.
  it('feeds the saved settings straight into the seeding rules', async () => {
    const row = await create({
      ...BASE,
      isGroupBuy: true,
      gbPricePerKitPhp: 4500,
      gbVialsPerKit: 5,
      gbMinVials: 2,
      gbMaxVialsPerBatch: 8,
    });

    // The row as stored is a GroupBuyConfig — no adapter, no renaming.
    expect(groupBuyUnitPrice(row, 'piece')).toBe(900);
    expect(kahatiDefaultsFor(row)).toEqual({ pricePerKitPhp: 4500, minVials: 2, totalSlots: 8 });
    expect(campaignDefaultsFor(row).perCustomerMin).toBe(1);
  });
});
