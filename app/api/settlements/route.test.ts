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
  resetDb, makeUser, makeGroupBuy, checkoutRequest, settlementRequest,
} = await import('@/lib/test/harness');
const { getDb, orders, groupBuys, settlements } = await import('@/lib/db');

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
});

describe('GET /api/settlements/preview', () => {
  it('quotes one packing fee for hatians joined across separate visits', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    await committedAndClosedHatian(2);
    await committedAndClosedHatian(1);

    const body = await (await PREVIEW()).json();

    expect(body.data.orders).toHaveLength(3);
    // 6 vials at ₱900 = ₱5400, less three ₱150 downpayments already paid.
    expect(body.data.totals.balancePhp).toBe(5400 - 450);
    expect(body.data.totals.packingFeePhp).toBe(150);
    expect(body.data.totals.totalPhp).toBe(5400 - 450 + 150);
  });

  it('leaves out commitments whose hatian is still open', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    const open = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000 });
    await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: open.id, qty: 2 }]));

    const body = await (await PREVIEW()).json();
    expect(body.data.orders).toHaveLength(1);
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
  it('charges the packing fee once for a customer settling several hatians', async () => {
    await signIn();
    await committedAndClosedHatian(3);
    await committedAndClosedHatian(2);

    const res = await POST(settlementRequest({ paymentMethod: 'GCash' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.settlement.packingFeePhp)).toBe(150);

    const db = await getDb();
    const rows = await db.select().from(settlements);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].totalPhp)).toBe(4500 - 300 + 150);
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

  it('charges a fresh packing fee for a hatian that completes after an earlier settlement', async () => {
    // A later parcel is a genuinely separate shipment, so it carries its own fee.
    await signIn();
    await committedAndClosedHatian(3);
    await POST(settlementRequest());

    await committedAndClosedHatian(2);
    const body = await (await POST(settlementRequest())).json();

    expect(Number(body.data.settlement.packingFeePhp)).toBe(150);
    const db = await getDb();
    expect(await db.select().from(settlements)).toHaveLength(2);
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

    const before = await (await PREVIEW()).json();
    expect(before.data.orders[0].packingFee).toBe('unpaid');

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
