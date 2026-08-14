// Group Buy (MOQ campaign) commitments go through the cart and the ordinary
// checkout, exactly like every other purchasing mode.
//
// Until now a campaign commitment was its own payment path: the sheet took the
// buyer's details and proof and posted straight to /api/campaigns/:id/commit,
// so a customer could not put two group buys in one basket, could not shop on
// afterwards, and paid a packing fee per commitment. These tests pin the cart
// route instead — one order per parcel, one packing fee per checkout, and the
// batch splitting preserved as it moves.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';

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
const { staleCheckoutLine } = await import('@/lib/checkout-error');
const { getDb, moqCampaigns, orders, orderItems, products } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeMoqCampaign, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const campaignLine = (refId: string, qty = 1) => ({ kind: 'moq_campaign' as const, refId, qty });

// Every batch in a series, oldest first.
async function batchesOf(seriesId: string) {
  return (await getDb()).select().from(moqCampaigns)
    .where(eq(moqCampaigns.seriesId, seriesId))
    .orderBy(asc(moqCampaigns.batchNo));
}

async function itemsOf(orderId: string) {
  return (await getDb()).select().from(orderItems).where(eq(orderItems.orderId, orderId));
}

async function checkout(items: unknown[], opts: Parameters<typeof checkoutRequest>[1] = {}) {
  const res = await POST(checkoutRequest(items, opts));
  return { res, body: await res.json() };
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('a group buy commitment placed from the cart', () => {
  it('creates a group_buy order holding the committed kits', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 0, pricePerKitPhp: 10400 });

    const { res, body } = await checkout([campaignLine(c.id, 2)]);

    expect(res.status).toBe(201);
    expect(body.data.order.buyType).toBe('group_buy');
    expect(Number(body.data.order.subtotalPhp)).toBe(20800);

    const [batch] = await batchesOf(c.seriesId);
    expect(batch.committed).toBe(2);
  });

  it('links the order line to the batch that holds the kits', async () => {
    const user = await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 0 });

    await checkout([campaignLine(c.id, 2)]);

    const db = await getDb();
    const [placed] = await db.select().from(orders).where(eq(orders.userId, user.id));
    const [line] = await itemsOf(placed.id);
    expect(line.kind).toBe('moq_campaign');
    expect(line.moqCampaignId).toBe(c.id);
    expect(line.qty).toBe(2);
  });

  it('charges the campaign packing fee once, not once per group buy in the cart', async () => {
    // The whole point of moving this into the cart: three group buys bought
    // together ship as one parcel and cost one packing fee.
    await signIn();
    const a = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    const b = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 12000 });
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 8000 });

    const { body } = await checkout([campaignLine(a.id), campaignLine(b.id), campaignLine(c.id)]);

    expect(body.data.orders).toHaveLength(1);
    expect(Number(body.data.order.packingFeePhp)).toBe(300);
    expect(Number(body.data.order.subtotalPhp)).toBe(30000);
    expect(Number(body.data.order.totalPhp)).toBe(30300);
  });

  it('keeps a group buy and an on-hand item in separate orders with their own fees', async () => {
    // Different modes ship as different parcels, so each carries its own fee —
    // the "once per checkout" rule is once per parcel, not once per basket.
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    const p = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const { body } = await checkout([
      campaignLine(c.id),
      { kind: 'product', refId: p.id, qty: 2, unit: 'piece' },
    ]);

    const placed: Array<{ order: { buyType: string; packingFeePhp: string } }> = body.data.orders;
    expect(placed).toHaveLength(2);
    const byType = new Map(placed.map((o) => [o.order.buyType, Number(o.order.packingFeePhp)]));
    expect(byType.get('group_buy')).toBe(300);
    expect(byType.get('solo')).toBe(200);
  });

  it('requires a payment proof — a group buy is paid in full at checkout', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10 });

    const { res } = await checkout([campaignLine(c.id)], { withProof: false });

    expect(res.status).toBe(400);
  });

  it('enforces the campaign per-customer minimum', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, perCustomerMin: 3 });

    const { res, body } = await checkout([campaignLine(c.id, 2)]);

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/minimum/i);
  });
});

describe('batch splitting survives the move to the cart', () => {
  it('fills the open batch, seals it and rolls the remainder into its successor', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 8 });

    const { res } = await checkout([campaignLine(c.id, 5)]);
    expect(res.status).toBe(201);

    const [first, second, ...rest] = await batchesOf(c.seriesId);
    expect(rest).toHaveLength(0);
    expect(first).toMatchObject({ batchNo: 1, committed: 10, status: 'completed' });
    expect(second).toMatchObject({ batchNo: 2, committed: 3, status: 'open' });
  });

  it('bills a split commitment as one order carrying one packing fee', async () => {
    const user = await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 8, pricePerKitPhp: 10400 });

    await checkout([campaignLine(c.id, 5)]);

    const db = await getDb();
    const placed = await db.select().from(orders).where(eq(orders.userId, user.id));
    expect(placed).toHaveLength(1);
    expect(await itemsOf(placed[0].id)).toHaveLength(2);
    expect(Number(placed[0].subtotalPhp)).toBe(52000);
    expect(Number(placed[0].packingFeePhp)).toBe(300);
  });

  it('routes a line pointing at a completed batch into the open one', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 10, status: 'completed' });

    const { res } = await checkout([campaignLine(c.id, 4)]);
    expect(res.status).toBe(201);

    const [first, second] = await batchesOf(c.seriesId);
    expect(first).toMatchObject({ committed: 10, status: 'completed' });
    expect(second).toMatchObject({ batchNo: 2, committed: 4, status: 'open' });
  });

  it('names the dead line so the persisted cart can drop it', async () => {
    // The cart lives in localStorage: a line the shop can no longer sell loops
    // the same 400 on every retry and takes the whole basket down with it. The
    // rejection has to carry the refId for staleCheckoutLine to match on.
    await signIn();
    const dead = await makeMoqCampaign({ moq: 10, status: 'cancelled' });

    const { body } = await checkout([campaignLine(dead.id)]);

    expect(staleCheckoutLine(body.error)).toEqual({ refId: dead.id });
  });

  it('names a campaign that no longer exists at all', async () => {
    await signIn();
    const gone = '00000000-0000-4000-8000-000000000000';

    const { body } = await checkout([campaignLine(gone)]);

    expect(staleCheckoutLine(body.error)).toEqual({ refId: gone });
  });

  it('refuses a commitment to a series the admin has cancelled, rather than opening a fresh batch', async () => {
    // Batch #1 filled and sealed, #2 opened, the admin cancelled #2. A cart line
    // still pointing at #1 must not roll forward into a brand-new open batch #3
    // — that revives a group buy the admin deliberately ended, and takes money
    // for it.
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 9 });
    await checkout([campaignLine(c.id)]);            // fills #1, opens #2
    const [, second] = await batchesOf(c.seriesId);
    const db = await getDb();
    await db.update(moqCampaigns).set({ status: 'cancelled' }).where(eq(moqCampaigns.id, second.id));

    const { res } = await checkout([campaignLine(c.id)]);

    expect(res.status).toBe(400);
    expect(await batchesOf(c.seriesId)).toHaveLength(2);
  });

  it('refuses a cancelled campaign and rolls back the rest of the cart', async () => {
    await signIn();
    const dead = await makeMoqCampaign({ moq: 10, status: 'cancelled' });
    const p = await makeProduct({ onHandPiecePhp: 550, stock: 50 });

    const { res } = await checkout([
      { kind: 'product', refId: p.id, qty: 2, unit: 'piece' },
      campaignLine(dead.id),
    ]);

    expect(res.status).toBe(400);
    const db = await getDb();
    // The on-hand stock draw rolled back with the failed commitment.
    const [fresh] = await db.select().from(products).where(eq(products.id, p.id));
    expect(fresh.stock).toBe(50);
    expect(await db.select().from(orders)).toHaveLength(0);
  });
});

describe('repeat commitments to the same group buy', () => {
  // The packing fee buys a parcel, not a commitment. A customer who already has
  // an order standing in a group buy has paid for that parcel; ordering more
  // from the same group buy joins the parcel they already paid to have packed.
  it('charges the packing fee on the first order', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });

    const { body } = await checkout([campaignLine(c.id)]);

    expect(Number(body.data.order.packingFeePhp)).toBe(300);
    expect(Number(body.data.order.totalPhp)).toBe(10300);
  });

  it('charges no packing fee on a second order in the same group buy', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    await checkout([campaignLine(c.id)]);

    const { body } = await checkout([campaignLine(c.id)]);

    expect(Number(body.data.order.packingFeePhp)).toBe(0);
    expect(Number(body.data.order.totalPhp)).toBe(10000);
  });

  it('waives the fee for the successor batch of the same series', async () => {
    // A batch that fills rolls into its successor; to the customer that is still
    // the same group buy, so it must not re-charge the packing fee.
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 9, pricePerKitPhp: 10000 });
    await checkout([campaignLine(c.id)]);           // fills batch #1, seals it

    const { body } = await checkout([campaignLine(c.id, 2)]); // lands in batch #2

    expect(Number(body.data.order.packingFeePhp)).toBe(0);
  });

  it('charges nothing for a different group buy in the same cycle', async () => {
    // The fee follows the CYCLE, not the campaign series: everything joined
    // between one opening and the next ships as one parcel.
    await signIn();
    const joined = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    const other = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    await checkout([campaignLine(joined.id)]);

    const { body } = await checkout([campaignLine(other.id)]);

    expect(Number(body.data.order.packingFeePhp)).toBe(0);
  });

  it('charges nothing for a cart of group buys once the cycle is paid for', async () => {
    await signIn();
    const joined = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    const other = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    await checkout([campaignLine(joined.id)]);

    const { body } = await checkout([campaignLine(joined.id), campaignLine(other.id)]);

    expect(Number(body.data.order.packingFeePhp)).toBe(0);
  });

  it('charges nothing more even after the first order ships', async () => {
    // A cycle is a fixed period, not a parcel that can leave early. The
    // customer paid to have this cycle's goods packed; shipping one of the
    // orders sooner is not a reason to charge them for it a second time.
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    const { body: first } = await checkout([campaignLine(c.id)]);
    const db = await getDb();
    await db.update(orders).set({ status: 'shipped' }).where(eq(orders.id, first.data.order.id));

    const { body } = await checkout([campaignLine(c.id)]);

    expect(Number(body.data.order.packingFeePhp)).toBe(0);
  });

  it('does not let a fee-waived order alone carry the cycle', async () => {
    // Order #1 paid the fee, #2 rode on it for free. Cancelling #1 leaves only
    // a waived order behind, and a waived order is no source of a further
    // waiver — otherwise the fee chains away forever and nobody ever pays.
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    const { body: first } = await checkout([campaignLine(c.id)]);
    await checkout([campaignLine(c.id)]);
    const db = await getDb();
    await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, first.data.order.id));

    const { body } = await checkout([campaignLine(c.id)]);

    expect(Number(body.data.order.packingFeePhp)).toBe(300);
  });

  it('does not count a cancelled order as having paid the fee', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    const { body: first } = await checkout([campaignLine(c.id)]);
    const db = await getDb();
    await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, first.data.order.id));

    const { body } = await checkout([campaignLine(c.id)]);

    expect(Number(body.data.order.packingFeePhp)).toBe(300);
  });

  it('waives only the group buy fee — an on-hand item alongside still pays its own', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    const p = await makeProduct({ onHandPiecePhp: 550, stock: 50 });
    await checkout([campaignLine(c.id)]);

    const { body } = await checkout([
      campaignLine(c.id),
      { kind: 'product', refId: p.id, qty: 1, unit: 'piece' },
    ]);

    const placed: Array<{ order: { buyType: string; packingFeePhp: string } }> = body.data.orders;
    const byType = new Map(placed.map((o) => [o.order.buyType, Number(o.order.packingFeePhp)]));
    expect(byType.get('group_buy')).toBe(0);
    expect(byType.get('solo')).toBe(200);
  });

  it('keeps another customer paying their own fee', async () => {
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });
    await signIn();
    await checkout([campaignLine(c.id)]);

    await signIn(); // a different buyer entirely
    const { body } = await checkout([campaignLine(c.id)]);

    expect(Number(body.data.order.packingFeePhp)).toBe(300);
  });

  it('charges one cycle fee when the same customer checks out concurrently', async () => {
    const user = await signIn();
    const c = await makeMoqCampaign({ moq: 10, pricePerKitPhp: 10000 });

    const placed = await Promise.all([
      checkout([campaignLine(c.id)], { idempotencyKey: 'cycle-race-11111111' }),
      checkout([campaignLine(c.id)], { idempotencyKey: 'cycle-race-22222222' }),
    ]);

    expect(placed.map(({ res }) => res.status)).toEqual([201, 201]);

    const rows = await (await getDb()).select({ packingFeePhp: orders.packingFeePhp })
      .from(orders)
      .where(eq(orders.userId, user.id));
    expect(rows.map((row) => Number(row.packingFeePhp)).sort((a, b) => a - b)).toEqual([0, 300]);
  });
});
