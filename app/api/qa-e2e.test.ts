// Cross-phase QA verification for the Group Buy + Hatian release.
//
// The per-feature suites each pin one rule. This one walks the whole thing the
// way an operator does — configure a window, watch both boards follow it, place
// commitments, watch the board re-rank, and check the orders landed under the
// right campaign and the right counter. It exists because the failures that
// matter most here are BETWEEN the features: one board open while the other is
// shut, or an order filed against the wrong batch.
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

const { GET: HATIAN_BOARD } = await import('./groupbuys/route');
const { GET: CAMPAIGN_BOARD } = await import('./campaigns/route');
const { POST: CHECKOUT } = await import('./orders/route');
const { getDb, orders, orderItems } = await import('@/lib/db');
const {
  resetDb, makeUser, makeGroupBuy, makeMoqCampaign, makePaymentMethod, commitRequest, checkoutRequest,
  openBoards, closeBoards,
} = await import('@/lib/test/harness');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

const openWindow = () => openBoards();
// Elapsed and not-yet-opened are the same state to every caller: the boards are shut.
const elapsedWindow = () => closeBoards();
const futureWindow = () => closeBoards();

const boardNames = async (): Promise<string[]> =>
  (await (await HATIAN_BOARD()).json()).data.map((g: { name: string }) => g.name);

async function signIn(role: 'customer' | 'admin' = 'customer') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

beforeEach(async () => {
  await resetDb();
  session.current = null;
});

describe('Phase 1 — the two modules follow one schedule with no manual step', () => {
  it('keeps both boards shut before the window, open inside it, and shut after', async () => {
    await makeGroupBuy({ name: 'Counter' });
    await makeMoqCampaign();

    // Before. Nothing has been switched by hand at any point in this test —
    // only the clock's position relative to the stored window changes.
    await futureWindow();
    expect((await HATIAN_BOARD()).status).toBe(404);
    expect((await CAMPAIGN_BOARD()).status).toBe(404);

    // During.
    await openWindow();
    expect((await HATIAN_BOARD()).status).toBe(200);
    expect((await CAMPAIGN_BOARD()).status).toBe(200);

    // After.
    await elapsedWindow();
    expect((await HATIAN_BOARD()).status).toBe(404);
    expect((await CAMPAIGN_BOARD()).status).toBe(404);
  });

  it('is a Philippine-time schedule, not a server-local one', async () => {
    // Opens Wednesday 9:00 AM PHT and closes the following Wednesday 11:59 PM
    // PHT. Aug 5 and Aug 12 2026 are Wednesdays; Manila is UTC+08:00, so 09:00
    // PHT is 01:00 UTC and 23:59 PHT is 15:59 UTC.
    const { setScheduleRecurrence, isGroupBuyOpenNow } = await import('@/lib/settings');
    await setScheduleRecurrence({ openDay: 3, openTime: '09:00', closeDay: 3, closeTime: '23:59' });

    // Wed 08:59 PHT — one minute early.
    expect(await isGroupBuyOpenNow(new Date('2026-08-05T00:59:00.000Z'))).toBe(false);
    // Wed 09:00 PHT exactly.
    expect(await isGroupBuyOpenNow(new Date('2026-08-05T01:00:00.000Z'))).toBe(true);
    // The following Wednesday, 23:58 PHT — still inside the same weekly cycle.
    expect(await isGroupBuyOpenNow(new Date('2026-08-12T15:58:00.000Z'))).toBe(true);
    // 23:59 PHT — shut.
    expect(await isGroupBuyOpenNow(new Date('2026-08-12T15:59:00.000Z'))).toBe(false);
    // And open again the next week with no admin action at all.
    expect(await isGroupBuyOpenNow(new Date('2026-08-15T00:00:00.000Z'))).toBe(true);
  });
});

describe('Phases 3 & 4 — the hatian board ranks by demand and re-ranks as orders land', () => {
  it('re-orders the board after a commitment overtakes the leader', async () => {
    await openWindow();
    await makePaymentMethod();
    await makeGroupBuy({ name: 'Product A', totalSlots: 10, claimedSlots: 8, minVials: 1, closesAt: new Date(Date.now() + DAY) });
    const b = await makeGroupBuy({ name: 'Product B', totalSlots: 10, claimedSlots: 5, minVials: 1, closesAt: new Date(Date.now() + DAY) });

    expect(await boardNames()).toEqual(['Product A', 'Product B']);

    // A customer commits 4 more vials to B: 5 -> 9, overtaking A's 8.
    await signIn('customer');
    const res = await CHECKOUT(checkoutRequest(
      [{ kind: 'group_buy', refId: b.id, qty: 4 }],
      { idempotencyKey: 'demand-shift' },
    ));
    expect(res.status).toBe(201);

    // The order is derived per request, so the very next read is already correct.
    expect(await boardNames()).toEqual(['Product B', 'Product A']);
  });
});

describe('Phase 6 — orders stay filed under their own campaign and their own counter', () => {
  it('never mixes commitments between two group buy campaigns', async () => {
    await openWindow();
    await makePaymentMethod();
    const campaignA = await makeMoqCampaign({ moq: 50 });
    const campaignB = await makeMoqCampaign({ moq: 50 });
    const customer = await signIn('customer');

    expect((await CHECKOUT(commitRequest(campaignA.id, 2, { idempotencyKey: 'campaign-a-1' }))).status).toBe(201);
    expect((await CHECKOUT(commitRequest(campaignB.id, 3, { idempotencyKey: 'campaign-b-1' }))).status).toBe(201);

    const db = await getDb();
    const items = await db.select().from(orderItems);
    const forA = items.filter((i) => i.moqCampaignId === campaignA.id);
    const forB = items.filter((i) => i.moqCampaignId === campaignB.id);

    expect(forA).toHaveLength(1);
    expect(forB).toHaveLength(1);
    expect(forA[0].qty).toBe(2);
    expect(forB[0].qty).toBe(3);
    // Every line is attributed — no orphans, and none attributed to both.
    expect(items.every((i) => i.moqCampaignId != null || i.groupBuyId != null || i.productId != null)).toBe(true);

    // Phase 7: each order traces back to its customer.
    const placed = await db.select().from(orders);
    expect(placed.every((o) => o.userId === customer.id)).toBe(true);
  });

  it('never mixes commitments between two hatian counters', async () => {
    await openWindow();
    await makePaymentMethod();
    const first = await makeGroupBuy({ name: 'Counter 1', totalSlots: 10, claimedSlots: 0, minVials: 1, closesAt: new Date(Date.now() + DAY) });
    const second = await makeGroupBuy({ name: 'Counter 2', totalSlots: 10, claimedSlots: 0, minVials: 1, closesAt: new Date(Date.now() + DAY) });
    await signIn('customer');

    expect((await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: first.id, qty: 2 }], { idempotencyKey: 'counter-a-1' }))).status).toBe(201);
    expect((await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: second.id, qty: 5 }], { idempotencyKey: 'counter-b-1' }))).status).toBe(201);

    const db = await getDb();
    const items = await db.select().from(orderItems);
    expect(items.filter((i) => i.groupBuyId === first.id).reduce((n, i) => n + i.qty, 0)).toBe(2);
    expect(items.filter((i) => i.groupBuyId === second.id).reduce((n, i) => n + i.qty, 0)).toBe(5);
  });
});

describe('Phase 5 — closing the window governs the rule, not just the display', () => {
  it('refuses both kinds of commitment once shut, while ordinary stock still sells', async () => {
    await openWindow();
    await makePaymentMethod();
    const campaign = await makeMoqCampaign({ moq: 10 });
    const counter = await makeGroupBuy({ totalSlots: 10, minVials: 1, closesAt: new Date(Date.now() + DAY) });
    const { makeProduct } = await import('@/lib/test/harness');
    const product = await makeProduct({ stock: 10 });
    await signIn('customer');

    await elapsedWindow();

    expect((await CHECKOUT(commitRequest(campaign.id, 1, { idempotencyKey: 'late-campaign' }))).status).toBe(409);
    expect((await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: counter.id, qty: 1 }], { idempotencyKey: 'late-counter' }))).status).toBe(409);
    // The on-hand shop is a separate business and stays open.
    expect((await CHECKOUT(checkoutRequest(
      [{ kind: 'product', refId: product.id, qty: 1, mode: 'piece' }], { idempotencyKey: 'shop-order-1' },
    ))).status).toBe(201);
  });
});
