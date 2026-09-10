// The boards re-read themselves when a NEW CYCLE opens — without anyone pressing
// anything.
//
// lib/cycle-refresh.test.ts pins WHAT a refresh does. This pins WHEN. The two
// admin "Start new cycle" buttons are not the trigger the complaint was about:
// the batch of 2026-09-09 was opened by moving the SCHEDULE, and the boards were
// read hundreds of times after it opened while still showing August's listings
// at August's prices. A reset that depends on an operator remembering two
// buttons is the manual step that let 63 stale counters accumulate since Aug 12.
//
// So the first board read inside a cycle performs the refresh, the same lazy way
// every other lifecycle transition in this app happens (sweepKahatis,
// openDueBatches, the seeders). There is still no cron.
//
// It must happen ONCE per cycle, and that is the whole difficulty. "Have I
// already refreshed this cycle" cannot be derived from the window — it is state
// — so the cycle's own key is recorded when it is claimed. That is deliberately
// not the "currently open" flag lib/schedule.ts warns against: a lost or corrupt
// key makes a cycle refresh again, which is idempotent, rather than throwing the
// storefront open.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

// The campaigns board reads the session to decide whether to show scheduled
// batches, and next/headers has no request context under vitest. Mocked as an
// anonymous visitor, which is the audience this file is about: nobody is signed
// in, nobody presses anything, the board just gets loaded.
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  return {
    ApiError,
    getSession: async () => null,
    requireSession: async () => { throw new ApiError(401, 'Authentication required.'); },
    requireAdmin: async () => { throw new ApiError(403, 'Admin only.'); },
  };
});
import { getDb, groupBuys, moqCampaigns, products, settings } from '@/lib/db';
import { resetDb, makeProduct, makeGroupBuy, makeMoqCampaign, openBoards, closeBoards } from '@/lib/test/harness';
import { refreshBoardsForNewCycle, BOARDS_REFRESHED_KEY } from './cycle-boundary-server';
import { getCurrentCycle } from './settings';

const loadCounter = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row;
};

const repriceProduct = async (id: string, pricePhp: number) => {
  const db = await getDb();
  await db.update(products).set({ pricePhp: String(pricePhp) }).where(eq(products.id, id));
};

/** Forget that this cycle was ever refreshed — what a brand-new cycle looks like. */
const forgetRefreshedCycle = async () => {
  const db = await getDb();
  await db.delete(settings).where(eq(settings.key, BOARDS_REFRESHED_KEY));
};

beforeEach(async () => {
  await resetDb();
  await openBoards();
  // openBoards records the cycle as already started, which is right for every
  // other test. This file is about the moment BEFORE that.
  await forgetRefreshedCycle();
});

describe('refreshBoardsForNewCycle', () => {
  it('re-reads the empty counters the first time it runs in a cycle', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000 });
    await repriceProduct(product.id, 2263);

    const result = await refreshBoardsForNewCycle(db);

    expect(result.refreshed).toBe(true);
    expect(result.kahatis).toBe(1);
    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(2263);
  });

  // The reason the claim has to be recorded. Without it every board read would
  // reprice, and an admin who typed a deliberate discount into one counter would
  // watch it revert on the next page load.
  it('does not run twice in the same cycle', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000 });
    await repriceProduct(product.id, 2263);

    await refreshBoardsForNewCycle(db);
    // The admin's own decision, made mid-cycle, after the refresh has run.
    await db.update(groupBuys).set({ pricePerKitPhp: '1999' }).where(eq(groupBuys.id, counter.id));

    const second = await refreshBoardsForNewCycle(db);

    expect(second.refreshed).toBe(false);
    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(1999);
  });

  it('runs again once the next cycle opens', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000 });

    await refreshBoardsForNewCycle(db);
    await repriceProduct(product.id, 2263);
    // A fresh cycle is a different key, which is what unlocks the next refresh.
    await forgetRefreshedCycle();

    const next = await refreshBoardsForNewCycle(db);

    expect(next.refreshed).toBe(true);
    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(2263);
  });

  // Nothing to reset while nothing is trading, and no cycle to key the claim on.
  // Claiming one here would burn the next cycle's refresh on a dark board.
  it('does nothing while the boards are closed', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000 });
    await repriceProduct(product.id, 2263);
    await closeBoards();

    const result = await refreshBoardsForNewCycle(db);

    expect(result.refreshed).toBe(false);
    expect(Number((await loadCounter(counter.id)).pricePerKitPhp)).toBe(2000);
  });

  it('re-reads both boards, not just the counters', async () => {
    const db = await getDb();
    const product = await makeProduct({ isGroupBuy: true, name: 'NAD+', spec: '500mg vial', pricePhp: 3350 });
    const [batch] = await db.insert(moqCampaigns).values({
      name: 'Stale name', pricePerKitPhp: '9999', moq: 10, committed: 0,
      perCustomerMin: 1, shippingPhp: '150', status: 'open',
      includedProducts: [{ productId: product.id, name: 'NAD+', outOfStock: false }],
    }).returning();

    const result = await refreshBoardsForNewCycle(db);

    expect(result.campaigns).toBe(1);
    const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, batch.id));
    expect(row.name).toBe('NAD+ 500mg vial');
    expect(Number(row.pricePerKitPhp)).toBe(3350);
  });

  // A counter people joined LAST cycle is last cycle's batch. When the schedule
  // opens the next cycle, nobody has pressed "Start new cycle", and the board
  // must not go on offering the previous cycle's counter — vials and all — as
  // though it were this cycle's. The boundary seals it and opens its successor,
  // exactly as the button does; the commitments stay on the sealed row.
  it('seals a joined counter and opens an empty successor', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000, claimedSlots: 4 });

    const result = await refreshBoardsForNewCycle(db);

    expect(result.sealedKahatis).toBe(1);
    const sealed = await loadCounter(counter.id);
    expect(sealed.status).toBe('closed');
    expect(sealed.claimedSlots).toBe(4);
    const open = await db.select().from(groupBuys)
      .where(and(eq(groupBuys.productId, product.id), eq(groupBuys.status, 'open')));
    expect(open).toHaveLength(1);
    expect(open[0].claimedSlots).toBe(0);
  });

  it('seals a joined batch and opens the next batch in its series', async () => {
    const db = await getDb();
    const batch = await makeMoqCampaign({ committed: 3, moq: 10 });

    const result = await refreshBoardsForNewCycle(db);

    expect(result.sealedCampaigns).toBe(1);
    const [old] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, batch.id));
    expect(old.status).not.toBe('open');
    expect(old.committed).toBe(3);
    const open = await db.select().from(moqCampaigns)
      .where(and(eq(moqCampaigns.seriesId, batch.seriesId), eq(moqCampaigns.status, 'open')));
    expect(open).toHaveLength(1);
    expect(open[0].committed).toBe(0);
    expect(open[0].batchNo).toBe(2);
  });

  // Mid-cycle, a joined counter is a running batch: the claim is already spent,
  // so a later board read must never end it under its joiners.
  it('does not seal a counter joined after the cycle was claimed', async () => {
    const db = await getDb();
    await refreshBoardsForNewCycle(db);
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const counter = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000, claimedSlots: 4 });

    await refreshBoardsForNewCycle(db);

    expect((await loadCounter(counter.id)).status).toBe('open');
  });

  // Every listing the new cycle carries is named with it: the successors just
  // opened, the empties brought forward. That is what files them under this
  // cycle when they end, and what keeps them on the board until then.
  it('names every listing it carries into the cycle', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    const joined = await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000, claimedSlots: 4 });
    const empty = await makeGroupBuy({ name: 'Empty', pricePerKitPhp: 2000, claimedSlots: 0 });
    const batch = await makeMoqCampaign({ committed: 0 });
    const cycle = await getCurrentCycle();

    await refreshBoardsForNewCycle(db);

    expect((await loadCounter(empty.id)).cycleKey).toBe(cycle!.opensAt);
    const [successor] = await db.select().from(groupBuys)
      .where(and(eq(groupBuys.productId, product.id), eq(groupBuys.status, 'open')));
    expect(successor.cycleKey).toBe(cycle!.opensAt);
    const [carried] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, batch.id));
    expect(carried.cycleKey).toBe(cycle!.opensAt);
    // The sealed counter is not renamed: it traded last cycle.
    expect((await loadCounter(joined.id)).cycleKey).toBeNull();
  });

  // A Pasalo counter is still deciding on LAST cycle's vials; carrying it over
  // must not re-file it as this cycle's.
  it('leaves a pasalo counter filed under the cycle it took its vials in', async () => {
    const db = await getDb();
    const counter = await makeGroupBuy({ pricePerKitPhp: 2000, claimedSlots: 5, status: 'pasalo' });
    await db.update(groupBuys).set({ cycleKey: '2026-08-29T14:00:00.000Z' }).where(eq(groupBuys.id, counter.id));

    await refreshBoardsForNewCycle(db);

    expect((await loadCounter(counter.id)).cycleKey).toBe('2026-08-29T14:00:00.000Z');
  });

  // The board is polled, so two requests can land together and must not both
  // decide the cycle is unclaimed.
  //
  // What this test actually proves is weaker than its name would suggest, and
  // that is worth stating: PGlite serialises these three calls, so a naive
  // read-then-write would pass it too. Real exclusivity rests on the guarded
  // upsert in claimCycle, which is enforced by Postgres and cannot be exercised
  // on this driver (the suite runs PGlite; production runs postgres-js). The
  // test is kept as a regression guard on the once-per-cycle CONTRACT.
  it('claims the cycle once across repeated calls', async () => {
    const db = await getDb();
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000 });
    await repriceProduct(product.id, 2263);

    const results = await Promise.all([
      refreshBoardsForNewCycle(db),
      refreshBoardsForNewCycle(db),
      refreshBoardsForNewCycle(db),
    ]);

    expect(results.filter((r) => r.refreshed)).toHaveLength(1);
  });
});

// The complaint's own path: nobody presses anything, a customer just opens the
// board. Reading the counter out of the RESPONSE rather than out of the table,
// because the response is what the customer was shown the stale price in.
describe('the board a customer actually loads', () => {
  it('shows the catalog price on the first read of a new cycle', async () => {
    const { GET } = await import('@/app/api/groupbuys/route');
    const product = await makeProduct({ isKahati: true, pricePhp: 2000 });
    await makeGroupBuy({ productId: product.id, pricePerKitPhp: 2000, name: 'Test Peptide 10mg' });
    await repriceProduct(product.id, 2263);

    const body = await (await GET()).json();

    const listed = body.data.find((g: { name: string }) => g.name === 'Test Peptide 10mg');
    expect(Number(listed.pricePerKitPhp)).toBe(2263);
  });

  it('shows the catalog price on the Group Buy board too', async () => {
    const { GET } = await import('@/app/api/campaigns/route');
    const db = await getDb();
    const product = await makeProduct({ isGroupBuy: true, name: 'NAD+', spec: '500mg vial', pricePhp: 3350 });
    await db.insert(moqCampaigns).values({
      name: 'Stale name', pricePerKitPhp: '9999', moq: 10, committed: 0,
      perCustomerMin: 1, shippingPhp: '150', status: 'open',
      includedProducts: [{ productId: product.id, name: 'NAD+', outOfStock: false }],
    });

    const body = await (await GET()).json();

    const listed = body.data.find((c: { name: string }) => c.name === 'NAD+ 500mg vial');
    expect(listed).toBeDefined();
    expect(Number(listed.pricePerKitPhp)).toBe(3350);
  });
});
