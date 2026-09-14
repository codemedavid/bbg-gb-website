// Recording hatian balances that were paid through the wrong door.
//
// Before the order uploader started refusing them, a customer whose hatians had
// all closed could attach their balance screenshot to the ORDER. Nothing reads a
// balance off that — only a settlement clears it — so My Orders kept saying
// "ready to settle" and the admin Settlements queue never saw the payment.
// KH-2794 is the one that was reported; prod held 17.
//
// This finds them and files each as a settlement awaiting review. It never
// marks one paid: a screenshot with no amount on it is not a verified payment,
// and the admin approves it in the Settlements screen like any other.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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
    requireAdmin: async () => requireSession(),
  };
});

const { POST: CHECKOUT } = await import('@/app/api/orders/route');
const { resetDb, openBoards, makeUser, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');
const { getDb, orders, groupBuys, orderPaymentProofs, settlements, settlementPaymentProofs } = await import('@/lib/db');
const { readySettlementOrders } = await import('./settlement-server');
const { findBalanceProofOrders, recordBalanceProofSettlements } = await import('./balance-proof-settlement-server');

const HOUR_MS = 60 * 60 * 1000;

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

/**
 * A hatian commitment paid at checkout. `closed` seals its counter so the
 * balance is due; `lateProof` attaches a screenshot an hour after checkout,
 * the way KH-2794's balance arrived.
 */
async function hatianOrder({ closed = true, lateProof = true } = {}) {
  const gb = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150, totalSlots: 100 });
  const res = await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 3 }], { proofCount: 1 }));
  expect(res.status).toBe(201);
  const { orderNo } = (await res.json()).data as { orderNo: string };
  const db = await getDb();
  if (closed) await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, gb.id));
  const [order] = await db.select().from(orders).where(eq(orders.orderNo, orderNo));
  if (lateProof) {
    await db.insert(orderPaymentProofs).values({
      orderId: order.id, storageKey: `late/${orderNo}.png`, sortOrder: 1,
      uploadedAt: new Date(order.createdAt.getTime() + HOUR_MS),
    });
  }
  return order;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('findBalanceProofOrders', () => {
  it('finds a hatian ready to settle that carries a screenshot sent after checkout', async () => {
    await signIn();
    const order = await hatianOrder();

    const found = await findBalanceProofOrders(await getDb());

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ orderNo: order.orderNo, lateProofKeys: [`late/${order.orderNo}.png`] });
  });

  it('ignores one whose only proof is the checkout payment', async () => {
    await signIn();
    await hatianOrder({ lateProof: false });

    expect(await findBalanceProofOrders(await getDb())).toEqual([]);
  });

  // A counter still filling owes nothing but the checkout payment, so a later
  // screenshot there is a top-up of that — not a balance.
  it('ignores a hatian that is still filling', async () => {
    await signIn();
    await hatianOrder({ closed: false });

    expect(await findBalanceProofOrders(await getDb())).toEqual([]);
  });
});

describe('recordBalanceProofSettlements', () => {
  it('files the balance as a settlement awaiting review, never as paid', async () => {
    await signIn();
    const order = await hatianOrder();
    const db = await getDb();

    await recordBalanceProofSettlements(db, [order.orderNo]);

    const [row] = await db.select().from(settlements);
    expect(row.status).toBe('proof_review');
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after.settlementId).toBe(row.id);
  });

  it('carries the screenshot over so the admin can review it', async () => {
    await signIn();
    const order = await hatianOrder();
    const db = await getDb();

    await recordBalanceProofSettlements(db, [order.orderNo]);

    const proofs = await db.select().from(settlementPaymentProofs);
    expect(proofs.map((p) => p.storageKey)).toEqual([`late/${order.orderNo}.png`]);
  });

  // The whole point: the customer stops being asked for money already sent.
  it('takes the order out of the "ready to settle" prompt', async () => {
    const user = await signIn();
    const order = await hatianOrder();
    const db = await getDb();

    await recordBalanceProofSettlements(db, [order.orderNo]);

    expect(await readySettlementOrders(db, user.id)).toEqual([]);
  });

  it('files one settlement per customer, however many of their orders it covers', async () => {
    await signIn();
    const a = await hatianOrder();
    const b = await hatianOrder();
    const db = await getDb();

    await recordBalanceProofSettlements(db, [a.orderNo, b.orderNo]);

    expect(await db.select().from(settlements)).toHaveLength(1);
  });

  // Order numbers are typed by a person. One that is not a candidate must stop
  // the run before anything is written, not be skipped quietly.
  it('refuses an order number that is not a candidate, and writes nothing', async () => {
    await signIn();
    const order = await hatianOrder();
    const unready = await hatianOrder({ closed: false });
    const db = await getDb();

    await expect(recordBalanceProofSettlements(db, [order.orderNo, unready.orderNo]))
      .rejects.toThrow(unready.orderNo);
    expect(await db.select().from(settlements)).toEqual([]);
  });

  it('does nothing the second time it is run', async () => {
    await signIn();
    const order = await hatianOrder();
    const db = await getDb();
    await recordBalanceProofSettlements(db, [order.orderNo]);

    await expect(recordBalanceProofSettlements(db, [order.orderNo])).rejects.toThrow(order.orderNo);
    expect(await db.select().from(settlements)).toHaveLength(1);
  });
});
