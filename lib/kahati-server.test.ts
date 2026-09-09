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

const { sweepKahatis, closeFullKahati } = await import('./kahati-server');
const { POST: placeOrder } = await import('@/app/api/orders/route');
const { getDb, groupBuys, orders, orderItems, orderItemRefunds, orderStatusHistory, emailLog, products } = await import('@/lib/db');
const { resetDb, openBoards, makeUser, makeGroupBuy, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

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
  await openBoards();
});

describe('sweepKahatis — viability', () => {
  it('closes an expired hatian that met the 7-vial minimum', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, closesAt: past() });
    const db = await getDb();
    await db.update(groupBuys).set({ claimedSlots: 7 }).where(eq(groupBuys.id, gb.id));

    await sweepKahatis(db);

    expect(await statusOf(gb.id)).toBe('closed');
  });

  it('cancels an expired hatian one vial short of the minimum', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 6, minVials: 1, closesAt: past() });
    const db = await getDb();

    await sweepKahatis(db);

    expect(await statusOf(gb.id)).toBe('cancelled');
  });

  it('leaves a hatian alone while its deadline is in the future', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 2, closesAt: new Date(Date.now() + DAY) });
    const db = await getDb();

    await sweepKahatis(db);

    expect(await statusOf(gb.id)).toBe('open');
  });

  it('reports what it closed and cancelled', async () => {
    const good = await makeGroupBuy({ totalSlots: 10, claimedSlots: 8, minVials: 1, closesAt: past() });
    const bad = await makeGroupBuy({ totalSlots: 10, claimedSlots: 1, minVials: 1, closesAt: past() });
    const db = await getDb();

    const result = await sweepKahatis(db);

    expect(result.closed).toContain(good.id);
    expect(result.cancelled).toContain(bad.id);
  });
});

describe('sweepKahatis — failed hatian cancellation flow', () => {
  it("cancels every participant's order", async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const a = await joinKahati(gb.id, 2);
    const b = await joinKahati(gb.id, 3);   // 5 total — short of 7
    await expire(gb.id);
    const db = await getDb();

    await sweepKahatis(db);

    expect(await statusOf(gb.id)).toBe('cancelled');
    expect(await orderStatus(a.order.id)).toBe('cancelled');
    expect(await orderStatus(b.order.id)).toBe('cancelled');
  });

  it('records why each order was cancelled', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, name: 'Reta Hatian' });
    const { order } = await joinKahati(gb.id, 3);
    await expire(gb.id);
    const db = await getDb();

    await sweepKahatis(db);

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

    await sweepKahatis(db);

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

    await sweepKahatis(db);

    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(46); // the 4 drawn at checkout stay drawn
    expect(await orderStatus(soloOrder!.id)).toBe('proof_review');
  });

  // On-hand is RETAIL: the customer bought stock that was already sitting in the
  // inventory, and a hatian falling short has nothing to do with it. This order
  // used to be cancelled outright and the vials clawed back into stock, so a
  // failed hatian silently un-sold goods the customer had already paid for and
  // that were ready to ship.
  it('keeps the on-hand goods in a legacy pre-split mixed order', async () => {
    // Orders placed before checkout split by mode can hold both kinds on one
    // record, and those still exist in the database.
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

    await sweepKahatis(db);

    // Untouched: retail stock the customer bought is not un-sold by a hatian.
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(46);
    expect(await orderStatus(legacy.id)).not.toBe('cancelled');

    // Re-billed to the on-hand line alone — the hatian vial is not being
    // ordered, so it is not charged for.
    const [rebilled] = await db.select().from(orders).where(eq(orders.id, legacy.id));
    expect(Number(rebilled.subtotalPhp)).toBe(2200);
    expect(Number(rebilled.totalPhp)).toBe(2200 + 150);

    // The failed hatian vial is still owed back.
    const refunds = await db.select().from(orderItemRefunds)
      .where(eq(orderItemRefunds.orderId, legacy.id));
    expect(refunds).toHaveLength(1);
  });

  it('does not touch a hatian that succeeded', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinKahati(gb.id, 7);   // exactly viable
    await expire(gb.id);
    const db = await getDb();

    await sweepKahatis(db);

    expect(await statusOf(gb.id)).toBe('closed');
    expect(await orderStatus(order.id)).toBe('proof_review');
  });

  it('is idempotent — a second sweep neither re-cancels nor double-restocks', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const product = await makeProduct({ stock: 50 });
    const { order } = await joinKahati(gb.id, 2, [{ kind: 'product', refId: product.id, qty: 4, unit: 'piece' }]);
    await expire(gb.id);
    const db = await getDb();

    await sweepKahatis(db);
    await sweepKahatis(db);

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

    await sweepKahatis(db);

    expect(await orderStatus(other.order.id)).toBe('proof_review');
    expect(await statusOf(healthy.id)).toBe('open');
  });

  it('keeps the kahati line items for the customer\'s records', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinKahati(gb.id, 2);
    await expire(gb.id);
    const db = await getDb();

    await sweepKahatis(db);

    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('closeFullKahati returns both the sealed counter and the opened sibling', () => {
  it('seals the full counter and hands back the fresh open sibling', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 10, minVials: 1, name: 'Reta 20mg', pricePerKitPhp: 9000 });
    const db = await getDb();
    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, gb.id));

    const result = await closeFullKahati(db, row);

    expect(result).not.toBeNull();
    expect(result!.sealed).toMatchObject({ id: gb.id, status: 'closed' });
    // The sibling is a distinct, empty, open counter inheriting the listing.
    expect(result!.opened.id).not.toBe(gb.id);
    expect(result!.opened).toMatchObject({
      name: 'Reta 20mg', totalSlots: 10, minVials: 1, claimedSlots: 0, status: 'open',
    });
  });
});

// One checkout, several hatians.
//
// splitCartIntoOrders splits a cart by MODE, not by product (lib/order-modes.ts),
// so joining five hatians in one go produces ONE kahati order with five lines.
// releaseKahatiOrders cancelled the whole ORDER when any one of its counters
// failed, so a customer lost the four batches that reached their minimum
// because the fifth did not — and got a different outcome from the same
// purchase depending only on how many times they pressed checkout.
//
// lib/pasalo-server.ts:releaseRefundedLines already ends this at the Pasalo
// close, and says so: "the same order-granularity mistake this whole function
// was written to end, one level up". This is that level up.
describe('a hatian that fails inside a multi-counter order', () => {
  const joinBoth = async (failingId: string, healthyId: string) =>
    joinKahati(failingId, 3, [{ kind: 'group_buy', refId: healthyId, qty: 2 }]);

  it('leaves the order alive when another of its counters survived', async () => {
    const failing = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, name: 'Bioglutide' });
    const healthy = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, name: 'Retatrutide' });
    const { order } = await joinBoth(failing.id, healthy.id);

    await expire(failing.id);
    await sweepKahatis(await getDb());

    expect(await statusOf(failing.id)).toBe('cancelled');
    expect(await orderStatus(order.id)).not.toBe('cancelled');
  });

  it('keeps the surviving counter holding its vials', async () => {
    const failing = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const healthy = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    await joinBoth(failing.id, healthy.id);

    await expire(failing.id);
    const db = await getDb();
    await sweepKahatis(db);

    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, healthy.id));
    expect(row.claimedSlots).toBe(2);
    expect(row.status).not.toBe('cancelled');
  });

  // A customer must never be charged for a vial that was never ordered from the
  // supplier. The packing fee is NOT re-derived — the parcel is still being
  // packed — which is the same rule the Pasalo close applies.
  it('re-bills the order to the lines that survived', async () => {
    const failing = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const healthy = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinBoth(failing.id, healthy.id);

    const db = await getDb();
    const before = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const survivingTotal = before
      .filter((l) => l.groupBuyId === healthy.id)
      .reduce((sum, l) => sum + Number(l.lineTotalPhp), 0);

    await expire(failing.id);
    await sweepKahatis(db);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(Number(row.subtotalPhp)).toBe(survivingTotal);
    expect(Number(row.totalPhp)).toBe(survivingTotal + Number(row.packingFeePhp));
  });

  // Nothing survived, so there is no parcel — the order goes, exactly as before.
  it('still cancels an order whose every counter failed', async () => {
    const a = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const b = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinBoth(a.id, b.id);

    await expire(a.id);
    await expire(b.id);
    await sweepKahatis(await getDb());

    expect(await orderStatus(order.id)).toBe('cancelled');
  });
});


// A hatian cancelled for missing its minimum owes its participants their money,
// and said so in an email — but wrote no refund row. order_item_refunds was
// only ever written by the Pasalo close (lib/pasalo-server.ts), so a counter
// that expired short never reached the refund sheet or the refund export. The
// money was owed, the customer was told, and nothing tracked whether it was
// ever actually sent.
//
// The report itself was never the problem: it filters order_item_refunds by
// date alone (lib/report/pasalo-refund-server.ts), so rows written here show up
// in it without the report changing at all.
describe('a hatian that fails owes a refund the sheet can see', () => {
  const confirmPayment = async (orderId: string) => {
    const db = await getDb();
    await db.update(orders).set({ paymentStatus: 'confirmed' }).where(eq(orders.id, orderId));
  };

  it('writes a refund row for the line on the cancelled counter', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinKahati(gb.id, 3);
    await confirmPayment(order.id);
    await expire(gb.id);
    const db = await getDb();

    await sweepKahatis(db);

    const rows = await db.select().from(orderItemRefunds)
      .where(eq(orderItemRefunds.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].groupBuyId).toBe(gb.id);
  });

  // The deposit is what was actually collected at checkout, so it is what comes
  // back when no parcel ships.
  it('refunds the deposit the customer actually paid', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinKahati(gb.id, 3);
    await confirmPayment(order.id);
    await expire(gb.id);
    const db = await getDb();

    await sweepKahatis(db);

    const [placed] = await db.select().from(orders).where(eq(orders.id, order.id));
    const [refund] = await db.select().from(orderItemRefunds)
      .where(eq(orderItemRefunds.orderId, order.id));
    expect(Number(refund.depositPhp)).toBe(Number(placed.downpaymentPhp));
    expect(Number(refund.amountPhp)).toBe(Number(refund.goodsPhp) + Number(refund.depositPhp));
  });

  // order_item_refunds.order_item_id is unique, and that uniqueness IS the
  // anti-double-count guarantee. A repeat sweep must not book a second refund.
  it('does not book a second refund when the sweep runs again', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinKahati(gb.id, 3);
    await confirmPayment(order.id);
    await expire(gb.id);
    const db = await getDb();

    await sweepKahatis(db);
    await sweepKahatis(db);

    const rows = await db.select().from(orderItemRefunds)
      .where(eq(orderItemRefunds.orderId, order.id));
    expect(rows).toHaveLength(1);
  });

  // The customer is still getting a parcel, so the deposit that reserves its
  // place stays earned — only the failed vials are owed back. Refunding the
  // deposit here would pack their surviving batch for free.
  it('keeps the deposit when the order survives on another counter', async () => {
    const failing = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const healthy = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const { order } = await joinKahati(failing.id, 3, [{ kind: 'group_buy', refId: healthy.id, qty: 2 }]);
    await confirmPayment(order.id);
    await expire(failing.id);
    const db = await getDb();

    await sweepKahatis(db);

    const rows = await db.select().from(orderItemRefunds)
      .where(eq(orderItemRefunds.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].groupBuyId).toBe(failing.id);
    expect(Number(rows[0].depositPhp)).toBe(0);
  });
});
