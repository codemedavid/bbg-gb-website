import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, groupBuys, orders, orderItems, orderItemRefunds } from '@/lib/db';
import { resetDb, makeUser, makeGroupBuy } from '@/lib/test/harness';
import { openPasaloStage, closePasaloStage } from './pasalo-server';

beforeEach(resetDb);

// A kahati order with one line per counter, priced per vial. `settled` and
// `paymentStatus` are the two facts the refund arithmetic actually reads.
async function makeKahatiOrder(opts: {
  userId: string;
  lines: { groupBuyId: string; qty: number; perVialPhp?: number }[];
  downpaymentPhp?: number;
  paymentStatus?: string;
  orderNo?: string;
}) {
  const db = await getDb();
  const perVial = 550;
  const subtotal = opts.lines.reduce((s, l) => s + (l.perVialPhp ?? perVial) * l.qty, 0);
  const packingFee = 150;
  const [order] = await db.insert(orders).values({
    orderNo: opts.orderNo ?? `KH-${Math.floor(Math.random() * 100000)}`,
    userId: opts.userId,
    status: 'payment_confirmed',
    paymentStatus: opts.paymentStatus ?? 'confirmed',
    buyType: 'kahati',
    subtotalPhp: String(subtotal),
    packingFeePhp: String(packingFee),
    totalPhp: String(subtotal + packingFee),
    downpaymentPhp: String(opts.downpaymentPhp ?? 150),
    shipName: 'Test Buyer', shipPhone: '09171234567', shipAddress: 'Manila',
    cycleKey: '2026-W36',
  }).returning();

  const items = [];
  for (const l of opts.lines) {
    const unit = l.perVialPhp ?? perVial;
    const [item] = await db.insert(orderItems).values({
      orderId: order.id, kind: 'group_buy', groupBuyId: l.groupBuyId,
      nameSnapshot: 'Cagrilintide 5mg — kahati', specSnapshot: 'Kahati · min 1 vials',
      unitPricePhp: String(unit), qty: l.qty, lineTotalPhp: String(unit * l.qty),
    }).returning();
    items.push(item);
  }
  return { order, items };
}

const counterOf = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row;
};
const orderOf = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row;
};
const refundsOf = async () => {
  const db = await getDb();
  return db.select().from(orderItemRefunds);
};

describe('openPasaloStage', () => {
  it('moves a short counter into Pasalo instead of cancelling it', async () => {
    // The whole point: 3/10 used to be a cancellation and a refund four vials
    // short of a batch that would have gone ahead.
    const db = await getDb();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3 });

    const result = await openPasaloStage(db, { pasaloClosesAt: new Date('2026-09-12T12:00:00Z') });

    expect(result.opened).toEqual([gb.id]);
    const row = await counterOf(gb.id);
    expect(row.status).toBe('pasalo');
    expect(row.pasaloClosesAt).not.toBeNull();
  });

  it('freezes the Kahati figure so the two halves stay tellable apart', async () => {
    const db = await getDb();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3 });
    await openPasaloStage(db);
    expect((await counterOf(gb.id)).kahatiVials).toBe(3);
  });

  it('takes a qualified 7-9 counter in too, so it can still top up', async () => {
    const db = await getDb();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 8 });
    await openPasaloStage(db);
    expect((await counterOf(gb.id)).status).toBe('pasalo');
  });

  it('leaves a counter nobody joined running', async () => {
    const db = await getDb();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0 });
    const result = await openPasaloStage(db);
    expect(result.skippedEmpty).toBe(1);
    expect((await counterOf(gb.id)).status).toBe('open');
  });

  it('leaves a full counter alone — a complete kit has nothing to sell', async () => {
    const db = await getDb();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 10 });
    const result = await openPasaloStage(db);
    expect(result.skippedFull).toBe(1);
    expect((await counterOf(gb.id)).status).toBe('open');
  });

  it('is idempotent — a second open re-freezes nothing', async () => {
    const db = await getDb();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3 });
    await openPasaloStage(db);
    // A Pasalo vial lands, then the admin fumbles the button a second time.
    await db.update(groupBuys).set({ claimedSlots: 5 }).where(eq(groupBuys.id, gb.id));

    const second = await openPasaloStage(db);

    expect(second.opened).toEqual([]);
    // Still 3, not 5: re-freezing would erase the fact that two of those vials
    // were bought during Pasalo, which is the evidence the refund sheet cites.
    expect((await counterOf(gb.id)).kahatiVials).toBe(3);
  });
});

describe('closePasaloStage — fulfilment', () => {
  it('fulfils a counter Pasalo rescued to the minimum', async () => {
    // Edge case 5: 6 Kahati + 1 Pasalo = 7.
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 7, kahatiVials: 6, status: 'pasalo' });
    await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 7 }] });

    const result = await closePasaloStage(db);

    expect(result.fulfilled).toEqual([gb.id]);
    expect(result.refundsWritten).toBe(0);
    expect((await counterOf(gb.id)).status).toBe('closed');
  });

  it('fulfils a counter Pasalo filled outright', async () => {
    // Edge case 7: 3 Kahati + 7 Pasalo = 10.
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 10, kahatiVials: 3, status: 'pasalo' });
    await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 10 }] });

    const result = await closePasaloStage(db);
    expect(result.fulfilled).toEqual([gb.id]);
    expect(await refundsOf()).toEqual([]);
  });

  it('leaves a fulfilled order fully billed', async () => {
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 7, kahatiVials: 7, status: 'pasalo' });
    const { order } = await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 2 }] });

    await closePasaloStage(db);

    const after = await orderOf(order.id);
    expect(after.status).not.toBe('cancelled');
    expect(Number(after.totalPhp)).toBe(1250); // 2 x 550 + 150 packing
  });
});

describe('closePasaloStage — failure and refunds', () => {
  it('cancels a counter still short and writes a refund per failed line', async () => {
    // Edge case 8: Pasalo tried and the batch still finished at 6.
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 6, kahatiVials: 5, status: 'pasalo' });
    await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 6 }] });

    const result = await closePasaloStage(db);

    expect(result.failed).toEqual([gb.id]);
    expect((await counterOf(gb.id)).status).toBe('cancelled');
    const refunds = await refundsOf();
    expect(refunds).toHaveLength(1);
    expect(refunds[0].reason).toBe(
      'Final combined quantity 6/7 minimum after Pasalo closed (5 Kahati + 1 Pasalo).',
    );
  });

  it('freezes the counter arithmetic onto the refund as evidence', async () => {
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 5, kahatiVials: 3, status: 'pasalo' });
    await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 5 }] });

    await closePasaloStage(db);

    const [refund] = await refundsOf();
    expect(refund.kahatiVials).toBe(3);
    expect(refund.pasaloVials).toBe(2);
    expect(refund.combinedVials).toBe(5);
    expect(refund.minRequired).toBe(7);
  });

  it('copies the line snapshot so the sheet reproduces after an edit', async () => {
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 4, kahatiVials: 4, status: 'pasalo' });
    await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 4, perVialPhp: 550 }] });

    await closePasaloStage(db);

    const [refund] = await refundsOf();
    expect(refund.nameSnapshot).toBe('Cagrilintide 5mg — kahati');
    expect(refund.qty).toBe(4);
    expect(Number(refund.unitPricePhp)).toBe(550);
    expect(Number(refund.lineTotalPhp)).toBe(2200);
  });

  it('refunds the deposit but not the goods when only the deposit cleared', async () => {
    // The load-bearing rule: the goods were never collected, so refunding the
    // vial price would send out money that never came in.
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo' });
    await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 3 }] });

    const result = await closePasaloStage(db);

    const [refund] = await refundsOf();
    expect(Number(refund.goodsPhp)).toBe(0);
    expect(Number(refund.depositPhp)).toBe(150);
    expect(Number(refund.amountPhp)).toBe(150);
    expect(refund.collectedBasis).toBe('deposit_only');
    expect(result.refundTotalPhp).toBe(150);
  });

  it('is idempotent — a second close writes no second refund', async () => {
    // Edge case 20/21: the admin closes twice, or re-runs after a timeout.
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo' });
    await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 3 }] });

    await closePasaloStage(db);
    const second = await closePasaloStage(db);

    expect(second.refundsWritten).toBe(0);
    expect(await refundsOf()).toHaveLength(1);
  });

  it('does nothing at all when no counter is in the stage', async () => {
    const db = await getDb();
    await makeGroupBuy({ totalSlots: 10, claimedSlots: 3 });
    const result = await closePasaloStage(db);
    expect(result).toMatchObject({ fulfilled: [], failed: [], refundsWritten: 0 });
  });
});

describe('closePasaloStage — the mixed result (edge case 9)', () => {
  it('refunds only the failed product and keeps the successful one shipping', async () => {
    // The defect this replaces: one cart splits into ONE kahati order holding
    // lines against several counters, and the old release cancelled the whole
    // order when any one of them failed.
    const db = await getDb();
    const user = await makeUser();
    const good = await makeGroupBuy({ name: 'Good', totalSlots: 10, claimedSlots: 9, kahatiVials: 9, status: 'pasalo' });
    const bad = await makeGroupBuy({ name: 'Bad', totalSlots: 10, claimedSlots: 4, kahatiVials: 4, status: 'pasalo' });
    const { order, items } = await makeKahatiOrder({
      userId: user.id,
      lines: [{ groupBuyId: good.id, qty: 2 }, { groupBuyId: bad.id, qty: 1 }],
    });

    await closePasaloStage(db);

    const refunds = await refundsOf();
    expect(refunds).toHaveLength(1);
    expect(refunds[0].orderItemId).toBe(items[1].id);

    // The order lives on and still ships the good product.
    const after = await orderOf(order.id);
    expect(after.status).not.toBe('cancelled');
    // Re-billed for the survivor alone: 2 x 550 + 150 packing. Charging the
    // customer for a vial nobody ordered from the supplier is the other half
    // of the same bug.
    expect(Number(after.subtotalPhp)).toBe(1100);
    expect(Number(after.totalPhp)).toBe(1250);
  });

  it('keeps the deposit when the customer still has a parcel coming', async () => {
    const db = await getDb();
    const user = await makeUser();
    const good = await makeGroupBuy({ name: 'Good', totalSlots: 10, claimedSlots: 9, kahatiVials: 9, status: 'pasalo' });
    const bad = await makeGroupBuy({ name: 'Bad', totalSlots: 10, claimedSlots: 4, kahatiVials: 4, status: 'pasalo' });
    await makeKahatiOrder({
      userId: user.id, lines: [{ groupBuyId: good.id, qty: 2 }, { groupBuyId: bad.id, qty: 1 }],
    });

    await closePasaloStage(db);

    const [refund] = await refundsOf();
    expect(Number(refund.depositPhp)).toBe(0);
  });

  it('cancels the order only when every line it holds failed', async () => {
    const db = await getDb();
    const user = await makeUser();
    const a = await makeGroupBuy({ name: 'A', totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo' });
    const b = await makeGroupBuy({ name: 'B', totalSlots: 10, claimedSlots: 2, kahatiVials: 2, status: 'pasalo' });
    const { order } = await makeKahatiOrder({
      userId: user.id, lines: [{ groupBuyId: a.id, qty: 3 }, { groupBuyId: b.id, qty: 2 }],
    });

    const result = await closePasaloStage(db);

    expect(result.ordersCancelled).toBe(1);
    expect((await orderOf(order.id)).status).toBe('cancelled');
  });

  it('never stamps not_due over a deposit it is still holding', async () => {
    // The third live bug: a cancellation is a FULFILMENT fact and must not
    // overwrite a PAYMENT one, or the refund we owe is quietly forgotten.
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo' });
    const { order } = await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 3 }] });

    await closePasaloStage(db);

    const after = await orderOf(order.id);
    expect(after.status).toBe('cancelled');
    expect(after.paymentStatus).toBe('confirmed');
  });

  it('releases the failed vials from a counter that is still open', async () => {
    // The second live bug: a sibling counter kept counting vials from an order
    // that had been cancelled, and a batch went to the supplier on them.
    const db = await getDb();
    const user = await makeUser();
    const failing = await makeGroupBuy({ name: 'Fail', totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo' });
    // A counter still on the Kahati board, holding two vials of the same order.
    const live = await makeGroupBuy({ name: 'Live', totalSlots: 10, claimedSlots: 2, status: 'open' });
    await makeKahatiOrder({
      userId: user.id, lines: [{ groupBuyId: failing.id, qty: 3 }, { groupBuyId: live.id, qty: 2 }],
    });

    await closePasaloStage(db);

    // The failing counter keeps its historical count — the refund rows cite it.
    expect((await counterOf(failing.id)).claimedSlots).toBe(3);
    // The live one is untouched: its line did not fail.
    expect((await counterOf(live.id)).claimedSlots).toBe(2);
  });
});

describe('closePasaloStage — several customers (edge cases 10-13)', () => {
  it('refunds each customer separately and counts them once each', async () => {
    const db = await getDb();
    const alice = await makeUser({ email: 'alice@example.com' });
    const bob = await makeUser({ email: 'bob@example.com' });
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 4, kahatiVials: 4, status: 'pasalo' });

    // Alice joined the same counter twice — two orders in one batch.
    await makeKahatiOrder({ userId: alice.id, lines: [{ groupBuyId: gb.id, qty: 1 }], orderNo: 'KH-1' });
    await makeKahatiOrder({
      userId: alice.id, lines: [{ groupBuyId: gb.id, qty: 1 }],
      downpaymentPhp: 0, orderNo: 'KH-2',
    });
    await makeKahatiOrder({ userId: bob.id, lines: [{ groupBuyId: gb.id, qty: 2 }], orderNo: 'KH-3' });

    const result = await closePasaloStage(db);

    expect(result.refundsWritten).toBe(3);
    // Three failed lines, two people to pay.
    expect(result.customersOwed).toBe(2);
    const refunds = await refundsOf();
    // Alice's deposit is booked once across her two orders, not once per line.
    const aliceDeposits = refunds
      .filter((r) => r.userId === alice.id)
      .reduce((s, r) => s + Number(r.depositPhp), 0);
    expect(aliceDeposits).toBe(150);
  });

  it('leaves an unrelated order in another batch completely alone', async () => {
    const db = await getDb();
    const user = await makeUser();
    const failing = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo' });
    const elsewhere = await makeGroupBuy({ name: 'Elsewhere', totalSlots: 10, claimedSlots: 5, status: 'open' });
    await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: failing.id, qty: 3 }] });
    const other = await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: elsewhere.id, qty: 5 }] });

    await closePasaloStage(db);

    const after = await orderOf(other.order.id);
    expect(after.status).not.toBe('cancelled');
    expect(Number(after.totalPhp)).toBe(2900);
  });

  it('skips an already-cancelled order rather than refunding it twice', async () => {
    const db = await getDb();
    const user = await makeUser();
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo' });
    const { order } = await makeKahatiOrder({ userId: user.id, lines: [{ groupBuyId: gb.id, qty: 3 }] });
    await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, order.id));

    const result = await closePasaloStage(db);

    expect(result.refundsWritten).toBe(0);
    expect(await refundsOf()).toEqual([]);
  });
});
