// Hatian expiry sweep and the failed-hatian cancellation flow.
//
// A hatian is viable at KAHATI_MIN_VIABLE_VIALS (7). Expiring at 7-10 vials is a
// success ("Good to Go") and closes the counter. Expiring below 7 cancels it, and
// every participant's order has to be cancelled, restocked and notified — the
// batch is never ordered, so nothing can be fulfilled.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

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
    ApiError, getSession: async () => session.current, requireSession,
    requireAdmin: async () => requireSession(),
  };
});

const { sweepExpiredKahatis } = await import('./kahati-server');
const { POST: placeOrder } = await import('@/app/api/orders/route');
const { getDb, groupBuys, orders, orderItems, orderStatusHistory, emailLog, products } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

const DAY = 24 * 60 * 60 * 1000;
const past = () => new Date(Date.now() - DAY);

type PlacedOrder = { id: string; orderNo: string; buyType: string };

// Checkout splits a mixed cart into one order per mode, so a join that also buys
// on-hand stock yields two orders. `order` is the kahati one — the subject of
// every sweep assertion — and `soloOrder` is the separate on-hand one, if any.
async function joinKahati(groupBuyId: string, qty: number, extra: unknown[] = []) {
  const user = await makeUser();
  session.current = { sub: user.id, role: 'customer', email: user.email };
  const res = await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: groupBuyId, qty }, ...extra]));
  const body = await res.json();
  if (res.status !== 201) throw new Error(`join failed: ${body.error}`);
  const placed = (body.data.orders as { order: PlacedOrder }[]).map((o) => o.order);
  const order = placed.find((o) => o.buyType === 'kahati');
  if (!order) throw new Error('join produced no kahati order');
  return { user, order, soloOrder: placed.find((o) => o.buyType === 'solo') };
}

async function statusOf(id: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row.status;
}

async function orderStatus(id: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row.status;
}

// Force a deadline into the past without going through the admin API.
async function expire(id: string) {
  const db = await getDb();
  await db.update(groupBuys).set({ closesAt: past() }).where(eq(groupBuys.id, id));
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('sweepExpiredKahatis — viability', () => {
  it('closes an expired hatian that met the 7-vial minimum', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, closesAt: past() });
    const db = await getDb();
    await db.update(groupBuys).set({ claimedSlots: 7 }).where(eq(groupBuys.id, gb.id));

    await sweepExpiredKahatis(db);

    expect(await statusOf(gb.id)).toBe('closed');
  });

  it('cancels an expired hatian one vial short of the minimum', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 6, minVials: 1, closesAt: past() });
    const db = await getDb();

    await sweepExpiredKahatis(db);

    expect(await statusOf(gb.id)).toBe('cancelled');
  });

  it('leaves a hatian alone while its deadline is in the future', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 2, closesAt: new Date(Date.now() + DAY) });
    const db = await getDb();

    await sweepExpiredKahatis(db);

    expect(await statusOf(gb.id)).toBe('open');
  });

  it('reports what it closed and cancelled', async () => {
    const good = await makeGroupBuy({ totalSlots: 10, claimedSlots: 8, minVials: 1, closesAt: past() });
    const bad = await makeGroupBuy({ totalSlots: 10, claimedSlots: 1, minVials: 1, closesAt: past() });
    const db = await getDb();

    const result = await sweepExpiredKahatis(db);

    expect(result.closed).toContain(good.id);
    expect(result.cancelled).toContain(bad.id);
  });
});

describe('sweepExpiredKahatis — failed hatian cancellation flow', () => {
  it("cancels every participant's order", async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const a = await joinKahati(gb.id, 2);
    const b = await joinKahati(gb.id, 3);   // 5 total — short of 7
    await expire(gb.id);
    const db = await getDb();

    await sweepExpiredKahatis(db);

    expect(await statusOf(gb.id)).toBe('cancelled');
    expect(await orderStatus(a.order.id)).toBe('cancelled');
    expect(await orderStatus(b.order.id)).toBe('cancelled');
  });

  it('records why each order was cancelled', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, name: 'Reta Hatian' });
    const { order } = await joinKahati(gb.id, 3);
    await expire(gb.id);
    const db = await getDb();

    await sweepExpiredKahatis(db);

    const history = await db.select().from(orderStatusHistory)
      .where(and(eq(orderStatusHistory.orderId, order.id), eq(orderStatusHistory.status, 'cancelled')));
    expect(history).toHaveLength(1);
    expect(history[0].note).toMatch(/Reta Hatian/);
  });

  it('emails every participant about the cancellation', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const a = await joinKahati(gb.id, 2);
    const b = await joinKahati(gb.id, 2);
    await expire(gb.id);
    const db = await getDb();

    await sweepExpiredKahatis(db);

    const sent = await db.select().from(emailLog).where(eq(emailLog.kind, 'kahati_cancelled'));
    expect(sent.map((e) => e.toEmail).sort()).toEqual([a.user.email, b.user.email].sort());
  });

  it('leaves the customer’s separate on-hand order alone when the hatian fails', async () => {
    // Checkout splits these into two orders, so the failed hatian cancels only
    // its own. The ready stock the customer also bought ships regardless — before
    // the split this cancelled their on-hand purchase too and clawed the vials
    // back, which was never the intent.
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const product = await makeProduct({ stock: 50 });
    const { soloOrder } = await joinKahati(gb.id, 2, [{ kind: 'product', refId: product.id, qty: 4, unit: 'piece' }]);
    await expire(gb.id);
    const db = await getDb();

    await sweepExpiredKahatis(db);

    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(46); // the 4 drawn at checkout stay drawn
    expect(await orderStatus(soloOrder!.id)).toBe('proof_review');
  });

  it('still restocks on-hand lines inside a legacy pre-split mixed order', async () => {
    // Orders placed before checkout split by mode can hold both kinds on one
    // record, and those still exist in the database — so the restock path in
    // releaseKahatiOrders has to keep working for them.
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const product = await makeProduct({ stock: 46 });
    const user = await makeUser();
    const db = await getDb();

    const [legacy] = await db.insert(orders).values({
      orderNo: 'BBG-LEGACY', userId: user.id, status: 'proof_review', buyType: 'kahati',
      subtotalPhp: '1000', packingFeePhp: '150', totalPhp: '1150', downpaymentPhp: '150',
      shipName: 'Legacy Buyer', shipPhone: '09171234567', shipAddress: 'Somewhere',
      paymentProofKey: 'legacy-proof',
    }).returning();
    await db.insert(orderItems).values([
      {
        orderId: legacy.id, kind: 'group_buy', groupBuyId: gb.id, nameSnapshot: 'Hatian vial',
        specSnapshot: 'Kahati · min 1 vials', unitPricePhp: '900', qty: 1, lineTotalPhp: '900',
      },
      {
        orderId: legacy.id, kind: 'product', productId: product.id, nameSnapshot: 'On-hand vial',
        specSnapshot: 'On-hand · per piece', unitPricePhp: '550', qty: 4, lineTotalPhp: '2200',
      },
    ]);
    await expire(gb.id);

    await sweepExpiredKahatis(db);

    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(50); // 46 + the 4 returned by the cancellation
    expect(await orderStatus(legacy.id)).toBe('cancelled');
  });

  it('does not touch a hatian that succeeded', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinKahati(gb.id, 7);   // exactly viable
    await expire(gb.id);
    const db = await getDb();

    await sweepExpiredKahatis(db);

    expect(await statusOf(gb.id)).toBe('closed');
    expect(await orderStatus(order.id)).toBe('proof_review');
  });

  it('is idempotent — a second sweep neither re-cancels nor double-restocks', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const product = await makeProduct({ stock: 50 });
    const { order } = await joinKahati(gb.id, 2, [{ kind: 'product', refId: product.id, qty: 4, unit: 'piece' }]);
    await expire(gb.id);
    const db = await getDb();

    await sweepExpiredKahatis(db);
    await sweepExpiredKahatis(db);

    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    // The on-hand lines now live on their own order, which the sweep never
    // touches — so stock is untouched by one sweep or by two.
    expect(row.stock).toBe(46);
    const history = await db.select().from(orderStatusHistory)
      .where(and(eq(orderStatusHistory.orderId, order.id), eq(orderStatusHistory.status, 'cancelled')));
    expect(history).toHaveLength(1);                  // not 2
    const sent = await db.select().from(emailLog).where(eq(emailLog.kind, 'kahati_cancelled'));
    expect(sent).toHaveLength(1);                     // not 2
  });

  it('leaves an unrelated order untouched', async () => {
    const failing = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const healthy = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    await joinKahati(failing.id, 1);
    const other = await joinKahati(healthy.id, 1);
    await expire(failing.id);
    const db = await getDb();

    await sweepExpiredKahatis(db);

    expect(await orderStatus(other.order.id)).toBe('proof_review');
    expect(await statusOf(healthy.id)).toBe('open');
  });

  it('keeps the kahati line items for the customer\'s records', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinKahati(gb.id, 2);
    await expire(gb.id);
    const db = await getDb();

    await sweepExpiredKahatis(db);

    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines.length).toBeGreaterThan(0);
  });
});
