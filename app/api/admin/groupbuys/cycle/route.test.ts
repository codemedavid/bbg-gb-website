// POST /api/admin/groupbuys/cycle — the hatian board's "Start new cycle".
//
// The mirror of POST /api/campaigns/cycle on the Group Buy side: one admin-only
// call that ends every counter with vials on it and opens each one's successor,
// so a trading cycle is closed from the board rather than card by card.
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
const { getDb, groupBuys } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy } = await import('@/lib/test/harness');
const { asc, eq } = await import('drizzle-orm');

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const countersNamed = async (name: string) => {
  const db = await getDb();
  return db.select().from(groupBuys).where(eq(groupBuys.name, name)).orderBy(asc(groupBuys.createdAt));
};

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('POST /api/admin/groupbuys/cycle', () => {
  it('ends every joined counter and opens its successor', async () => {
    await signIn('admin');
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 4 });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.kahati.rolled).toBe(1);
    const [sealed, successor] = await countersNamed('KLOW 80mg');
    expect(sealed.status).toBe('closed');
    expect(successor.status).toBe('open');
    expect(successor.claimedSlots).toBe(0);
  });

  // Said out loud in the response so the admin can be told the board was not
  // wiped — an empty counter that stayed put is not a failure.
  it('reports the counters it deliberately left running', async () => {
    await signIn('admin');
    await makeGroupBuy({ name: 'Joined', totalSlots: 10, claimedSlots: 2 });
    await makeGroupBuy({ name: 'Empty', totalSlots: 10, claimedSlots: 0 });

    const body = await (await POST()).json();

    expect(body.data.kahati.rolled).toBe(1);
    expect(body.data.kahati.skippedEmpty).toBe(1);
    expect(body.data.kahati.counters).toEqual([
      expect.objectContaining({ name: 'Joined', endedWithVials: 2 }),
    ]);
  });

  // The counters the cycle deliberately did not seal because a refund is owed on
  // them. The admin has to be able to see that those were left for the sweep
  // rather than quietly ended.
  it('reports counters left for the cancel sweep separately from empty ones', async () => {
    await signIn('admin');
    await makeGroupBuy({ name: 'Joined', totalSlots: 10, claimedSlots: 3 });
    await makeGroupBuy({ name: 'Empty', totalSlots: 10, claimedSlots: 0 });
    await makeGroupBuy({
      name: 'Expired thin', totalSlots: 10, claimedSlots: 2,
      closesAt: new Date(Date.now() - 60_000),
    });

    const body = await (await POST()).json();

    expect(body.data.kahati.rolled).toBe(1);
    expect(body.data.kahati.skippedEmpty).toBe(1);
    expect(body.data.kahati.leftForCancellation).toBe(1);
    expect(body.data.kahati.failed).toEqual([]);
    expect((await countersNamed('Expired thin'))[0].status).toBe('open');
  });

  it('refuses a customer', async () => {
    await signIn('customer');
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 4 });

    const res = await POST();

    expect(res.status).toBe(403);
    expect((await countersNamed('KLOW 80mg'))[0].status).toBe('open');
  });

  it('refuses a signed-out visitor', async () => {
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 4 });

    const res = await POST();

    expect(res.status).toBe(401);
    expect((await countersNamed('KLOW 80mg'))[0].status).toBe('open');
  });
});

// Reset must restore coverage even when the storefront is closed.
it('retains every enabled product across repeated resets, including missing boards', async () => {
  await signIn();
  const { makeProduct } = await import('@/lib/test/harness');
  const { products, moqCampaigns } = await import('@/lib/db');
  const { POST: campaignCycle } = await import('@/app/api/campaigns/cycle/route');
  const db = await getDb();
  const first = await makeProduct({ name: 'Five-vial kit', isKahati: true, isGroupBuy: true });
  const second = await makeProduct({ name: 'Second product', isKahati: true, isGroupBuy: true });
  await db.update(products).set({ gbVialsPerKit: 5 }).where(eq(products.id, first.id));
  for (let cycle = 0; cycle < 3; cycle++) {
    expect((await POST()).status).toBe(200);
    expect((await campaignCycle()).status).toBe(200);
    const counters = await db.select().from(groupBuys).where(eq(groupBuys.status, 'open'));
    const batches = await db.select().from(moqCampaigns).where(eq(moqCampaigns.status, 'open'));
    expect(counters.map((c) => c.productId).sort()).toEqual([first.id, second.id].sort());
    expect(counters.every((c) => c.claimedSlots === 0 && c.totalSlots === 10)).toBe(true);
    expect(batches).toHaveLength(2);
    expect(batches.every((b) => b.committed === 0 && b.moq === 10)).toBe(true);
    expect(batches.flatMap((b) => (b.includedProducts as { productId: string }[]).map((p) => p.productId)).sort())
      .toEqual([first.id, second.id].sort());
    expect(await db.select().from(products)).toHaveLength(2);
    // Simulate joins during each cycle; the next reset must archive them.
    await db.update(groupBuys).set({ claimedSlots: 2 }).where(eq(groupBuys.status, 'open'));
    await db.update(moqCampaigns).set({ committed: 2 }).where(eq(moqCampaigns.status, 'open'));
  }
});
