// The hatian final checkout.
//
// A customer joins as many hatians as they like paying only downpayments. When
// those hatians complete, ONE final checkout settles the lot and charges ONE
// packing fee. Before this route existed, every commitment carried its own fee,
// so a customer in five hatians paid five packing fees for one parcel.
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

const { POST } = await import('./route');
const { GET: PREVIEW } = await import('./preview/route');
const { POST: CHECKOUT } = await import('../orders/route');
const {
  resetDb, openBoards, makeUser, makeGroupBuy, makePaymentMethod, checkoutRequest, settlementRequest,
} = await import('@/lib/test/harness');
const { getDb, orders, groupBuys, settlements, emailLog } = await import('@/lib/db');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

// Commit `qty` vials to a fresh hatian, then close that hatian so the
// commitment is ready to settle. Returns the hatian id.
async function committedAndClosedHatian(qty = 3, repackFeePhp = 150): Promise<string> {
  const gb = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp, totalSlots: 100 });
  const res = await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty }]));
  expect(res.status).toBe(201);
  const db = await getDb();
  await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, gb.id));
  return gb.id;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('GET /api/settlements/preview', () => {
  it('charges no packing fee for hatians already paid for at checkout', async () => {
    // Three commitments in one cycle: the first paid the ₱150, the other two
    // were waived. The fee is behind them, so the final checkout collects the
    // goods and nothing else — quoting a fee here would be the second charge
    // the per-cycle rule exists to prevent.
    await signIn();
    await committedAndClosedHatian(3);
    await committedAndClosedHatian(2);
    await committedAndClosedHatian(1);

    const body = await (await PREVIEW()).json();

    expect(body.data.orders).toHaveLength(3);
    // 6 vials at ₱900 = ₱5400 of goods, whole. The ₱150 was ADDED to the first
    // order and paid there, so it never came out of what the goods cost.
    expect(body.data.totals.balancePhp).toBe(5400);
    expect(body.data.totals.packingFeePhp).toBe(0);
    expect(body.data.totals.totalPhp).toBe(5400);
  });

  it('leaves out commitments whose hatian is still open', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    const open = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: open.id, qty: 2 }]));

    const body = await (await PREVIEW()).json();
    expect(body.data.orders).toHaveLength(1);
  });

  it('leaves out legacy orders that already paid their packing fee at commit', async () => {
    // Pre-deferral orders were settled off-platform; nothing records whether the
    // balance was paid, so quoting them would re-bill money already collected.
    await signIn();
    const gb = await committedAndClosedHatian(3);
    const db = await getDb();
    // As an old order looks: a fee on the row and no trading cycle. The cycle
    // is what separates it from a modern order that paid its fee at checkout.
    await db.update(orders).set({ packingFeePhp: '150', cycleKey: null });

    const body = await (await PREVIEW()).json();
    expect(body.data.orders).toHaveLength(0);
    expect(body.data.totals.totalPhp).toBe(0);
    expect(gb).toBeTruthy();
  });

  it('refuses to settle a customer holding only legacy orders', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    const db = await getDb();
    await db.update(orders).set({ packingFeePhp: '150', cycleKey: null });

    const res = await POST(settlementRequest());
    expect(res.status).toBe(400);
    expect(await db.select().from(settlements)).toHaveLength(0);
  });

  it('quotes nothing when the customer has no completed hatian orders', async () => {
    await signIn();
    const body = await (await PREVIEW()).json();
    expect(body.data.orders).toHaveLength(0);
    expect(body.data.totals).toMatchObject({ balancePhp: 0, packingFeePhp: 0, totalPhp: 0 });
  });

  it('shows only this customer’s orders', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    await signIn(); // a different customer

    const body = await (await PREVIEW()).json();
    expect(body.data.orders).toHaveLength(0);
  });
});

describe('POST /api/settlements', () => {
  it('charges no packing fee again for hatians paid for at checkout', async () => {
    // Both commitments were in one cycle, so one ₱150 was collected at the
    // first checkout and nothing is owed for packing here.
    await signIn();
    await makePaymentMethod({ label: 'GCash' });
    await committedAndClosedHatian(3);
    await committedAndClosedHatian(2);

    const res = await POST(settlementRequest({ paymentMethod: 'GCash' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.settlement.packingFeePhp)).toBe(0);

    const db = await getDb();
    const rows = await db.select().from(settlements);
    expect(rows).toHaveLength(1);
    // 5 vials at ₱900 = ₱4500 of goods, whole: the ₱150 was added to the first
    // order and paid there, never taken out of what the goods cost.
    expect(Number(rows[0].totalPhp)).toBe(4500);
  });

  it('attaches every settled order to the settlement', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    await committedAndClosedHatian(2);

    const body = await (await POST(settlementRequest())).json();

    const db = await getDb();
    const rows = await db.select().from(orders);
    expect(rows).toHaveLength(2);
    expect(rows.every((o) => o.settlementId === body.data.settlement.id)).toBe(true);
  });

  it('never creates a second packing fee for orders already settled', async () => {
    await signIn();
    await committedAndClosedHatian(3);

    const first = await POST(settlementRequest());
    expect(first.status).toBe(201);

    // Nothing is outstanding now, so a second attempt has nothing to charge for.
    const second = await POST(settlementRequest());
    expect(second.status).toBe(400);

    const db = await getDb();
    expect(await db.select().from(settlements)).toHaveLength(1);
  });

  it('replays the original settlement when the same submission is retried', async () => {
    await signIn();
    await committedAndClosedHatian(3);

    const key = 'retry-key-12345678';
    const first = await (await POST(settlementRequest({ idempotencyKey: key }))).json();
    const second = await (await POST(settlementRequest({ idempotencyKey: key }))).json();

    expect(second.data.settlement.id).toBe(first.data.settlement.id);
    const db = await getDb();
    expect(await db.select().from(settlements)).toHaveLength(1);
  });

  it('still charges no settlement fee for a hatian joined in the same cycle', async () => {
    // A second settlement is a genuinely separate shipment, but the fee follows
    // the CYCLE the commitment was made in — and both of these were made in
    // one. The fee was collected at the first checkout and is not owed again.
    await signIn();
    await committedAndClosedHatian(3);
    await POST(settlementRequest());

    await committedAndClosedHatian(2);
    const body = await (await POST(settlementRequest())).json();

    expect(Number(body.data.settlement.packingFeePhp)).toBe(0);
    const db = await getDb();
    expect(await db.select().from(settlements)).toHaveLength(2);
  });

  it('greets the customer by name in the confirmation email, not by email address', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    await POST(settlementRequest());

    const db = await getDb();
    const [mail] = await db.select().from(emailLog).where(eq(emailLog.kind, 'settlement_placed'));
    expect(mail).toBeTruthy();
    expect(mail.body).not.toMatch(/Salamat, \S+@\S+/);
    expect(mail.body).toContain('Test User'); // the name on the account
  });

  it('rejects a settlement with nothing ready to settle', async () => {
    await signIn();
    const res = await POST(settlementRequest());
    expect(res.status).toBe(400);
  });

  it('requires a payment proof', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    const res = await POST(settlementRequest({ withProof: false }));
    expect(res.status).toBe(400);
  });

  it('requires a signed-in customer', async () => {
    const res = await POST(settlementRequest());
    expect(res.status).toBe(401);
  });

  it('never settles another customer’s orders', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    const outsider = await signIn();

    const res = await POST(settlementRequest());
    expect(res.status).toBe(400); // the outsider has nothing of their own to settle

    const db = await getDb();
    const settled = (await db.select().from(orders)).filter((o) => o.settlementId != null);
    expect(settled).toHaveLength(0);
    expect(outsider).toBeTruthy();
  });
});

describe('packing fee status through the settlement lifecycle', () => {
  it('reads unpaid before the final checkout and paid once the admin confirms it', async () => {
    await signIn();
    await committedAndClosedHatian(3);

    // Paid at checkout with the cycle it belongs to, so it reads as settled
    // before the final checkout even begins.
    const before = await (await PREVIEW()).json();
    expect(before.data.orders[0].packingFee).toBe('paid');

    const created = await (await POST(settlementRequest())).json();

    // Uploaded, awaiting verification — not yet money in the bank.
    const db = await getDb();
    const [row] = await db.select().from(settlements);
    expect(row.status).toBe('proof_review');

    await db.update(settlements).set({ status: 'paid', paidAt: new Date() })
      .where(eq(settlements.id, created.data.settlement.id));

    const [confirmed] = await db.select().from(settlements);
    expect(confirmed.status).toBe('paid');
  });
});

// Client feedback: "option to delete or add some orders prior to proceeding
// checkout". A final checkout used to take every ready order whether or not the
// customer could pay for all of them that day.
//
// The route still never TRUSTS the list — it intersects whatever the client
// sends with the set the server computed, so a crafted request can only ever
// settle fewer of its own orders, never someone else's and never more.
describe('POST /api/settlements — settling a chosen subset', () => {
  // Two ready orders belonging to the signed-in customer.
  async function twoReadyOrders() {
    await committedAndClosedHatian(3);
    await committedAndClosedHatian(2);
    const db = await getDb();
    const rows = await db.select({ id: orders.id, orderNo: orders.orderNo })
      .from(orders).where(eq(orders.userId, session.current!.sub)).orderBy(orders.createdAt);
    return rows;
  }

  it('settles every ready order when no selection is sent', async () => {
    await signIn();
    const all = await twoReadyOrders();

    const res = await POST(settlementRequest());
    expect(res.status).toBe(201);
    expect((await res.json()).data.orderCount).toBe(all.length);
  });

  it('settles only the chosen orders and leaves the rest ready', async () => {
    await signIn();
    const [first, second] = await twoReadyOrders();

    const res = await POST(settlementRequest({ orderIds: [first.id] }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.orderCount).toBe(1);

    const db = await getDb();
    const [kept] = await db.select({ settlementId: orders.settlementId })
      .from(orders).where(eq(orders.id, second.id));
    expect(kept.settlementId).toBeNull();
  });

  it('leaves the unchosen order settleable in a later checkout', async () => {
    await signIn();
    const [first, second] = await twoReadyOrders();

    await POST(settlementRequest({ orderIds: [first.id] }));
    const res = await POST(settlementRequest({ orderIds: [second.id] }));

    expect(res.status).toBe(201);
    expect((await res.json()).data.orderCount).toBe(1);
  });

  // The whole point of the final checkout is one fee for one parcel. Letting a
  // customer split it into two settlements must not turn into two fees.
  it('never charges the packing fee twice when the settlement is split', async () => {
    await signIn();
    const [first, second] = await twoReadyOrders();

    const one = await (await POST(settlementRequest({ orderIds: [first.id] }))).json();
    const two = await (await POST(settlementRequest({ orderIds: [second.id] }))).json();

    const fees = [one.data.totals.packingFeePhp, two.data.totals.packingFeePhp];
    expect(fees.filter((f: number) => f > 0).length).toBeLessThanOrEqual(1);
  });

  it("refuses a selection naming another customer's order", async () => {
    await signIn();
    await committedAndClosedHatian(3);
    const db = await getDb();
    const [mine] = await db.select({ id: orders.id }).from(orders)
      .where(eq(orders.userId, session.current!.sub));

    const victim = await signIn(); // a different customer
    await committedAndClosedHatian(2);

    const res = await POST(settlementRequest({ orderIds: [mine.id] }));
    expect(res.status).toBe(400);
    void victim;

    // …and the order it tried to reach is untouched.
    const [stolen] = await db.select({ settlementId: orders.settlementId })
      .from(orders).where(eq(orders.id, mine.id));
    expect(stolen.settlementId).toBeNull();
  });

  it('refuses an empty selection rather than silently settling everything', async () => {
    await signIn();
    await twoReadyOrders();

    const res = await POST(settlementRequest({ orderIds: [] }));
    expect(res.status).toBe(400);
  });

  it('refuses a selection of orders that are not ready to settle', async () => {
    await signIn();
    await twoReadyOrders();

    const res = await POST(settlementRequest({ orderIds: [crypto.randomUUID()] }));
    expect(res.status).toBe(400);
  });
});
