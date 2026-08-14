// One ₱150 packing fee per trading cycle, ADDED to the order.
//
// Two things the business stated, and both are pinned here as arithmetic rather
// than as wording:
//
//   1. The fee is added, never deducted. ₱4,000 of product plus a ₱150 packing
//      fee is a ₱4,150 order. The customer pays the ₱150 now and settles the
//      ₱4,000 after the hatian ends — so the ₱150 is what leaves their pocket
//      today, and it does not come out of what they owe for the goods.
//   2. It is charged once per active Group Buy/Hatian cycle, across BOTH boards.
//      Joining a hatian and then a group buy in the same week is one parcel and
//      one fee.
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
    requireAdmin: async () => requireSession(),
  };
});

const { POST } = await import('./route');
const {
  resetDb, makeUser, makeProduct, makeGroupBuy, makeMoqCampaign, makePaymentMethod,
  checkoutRequest, commitRequest, openBoards,
} = await import('@/lib/test/harness');
const { getDb, orders } = await import('@/lib/db');
const { PACKING_FEE_PHP } = await import('@/lib/pricing');

const KAHATI_FEE = 150;

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

/** Every order this customer has, oldest first. */
const placed = async () =>
  (await (await getDb()).select().from(orders)).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

/** A hatian priced so five vials come to exactly ₱4,000. */
const hatian = () => makeGroupBuy({ pricePerKitPhp: 8000, totalSlots: 10, minVials: 1, repackFeePhp: KAHATI_FEE });

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
  await makePaymentMethod();
});

describe('the ₱150 packing fee is added, not deducted', () => {
  it('adds the fee on top of the product total', async () => {
    // The client's own example: ₱4,000 of product, ₱150 to pack it, ₱4,150 due.
    await signIn();
    const gb = await hatian();

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 5 }]));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Number(body.data.order.subtotalPhp)).toBe(4000);
    expect(Number(body.data.order.packingFeePhp)).toBe(150);
    expect(Number(body.data.order.totalPhp)).toBe(4150);
  });

  it('leaves the product total whole — the fee is what is paid now', async () => {
    // The failure this test exists for: taking the ₱150 OUT of the ₱4,000, so
    // the customer sees a ₱3,850 balance and reads it as the fee being deducted
    // from their order.
    await signIn();
    const gb = await hatian();

    await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 5 }]));

    const [order] = await placed();
    // Paid today: the ₱150 fee. Left to settle after the hatian ends: the goods,
    // whole. A ₱3,850 balance here would mean the fee had come out of the order.
    expect(Number(order.downpaymentPhp)).toBe(150);
    expect(Number(order.totalPhp) - Number(order.downpaymentPhp)).toBe(4000);
  });

  it('records the fee as its own column, not folded into the subtotal', async () => {
    await signIn();
    const gb = await hatian();

    await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 5 }]));

    const [order] = await placed();
    expect(Number(order.subtotalPhp)).toBe(4000);
    expect(Number(order.packingFeePhp)).toBe(150);
  });
});

describe('one packing fee per cycle', () => {
  it('does not charge a second fee for another hatian in the same cycle', async () => {
    await signIn();
    const first = await hatian();
    const second = await hatian();

    await POST(checkoutRequest([{ kind: 'group_buy', refId: first.id, qty: 1 }]));
    await POST(checkoutRequest([{ kind: 'group_buy', refId: second.id, qty: 1 }]));

    const [one, two] = await placed();
    expect(Number(one.packingFeePhp)).toBe(150);
    expect(Number(two.packingFeePhp)).toBe(0);
  });

  it('does not charge again on the other board in the same cycle', async () => {
    // One schedule, one cycle, one parcel — so a hatian and a group buy in the
    // same week are one fee, not one each.
    await signIn();
    const gb = await hatian();
    const campaign = await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });

    await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 1 }]));
    await POST(commitRequest(campaign.id, 1));

    const [kahatiOrder, campaignOrder] = await placed();
    expect(Number(kahatiOrder.packingFeePhp)).toBe(150);
    expect(Number(campaignOrder.packingFeePhp)).toBe(0);
  });

  it('does not charge again the other way round either', async () => {
    await signIn();
    const campaign = await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });
    const gb = await hatian();

    await POST(commitRequest(campaign.id, 1));
    await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 1 }]));

    const [campaignOrder, kahatiOrder] = await placed();
    expect(Number(campaignOrder.packingFeePhp)).toBe(PACKING_FEE_PHP.group_buy);
    expect(Number(kahatiOrder.packingFeePhp)).toBe(0);
  });

  it('charges one fee for a cart that spans both boards at once', async () => {
    // A mixed cart splits into one order per mode. They ship as one parcel, so
    // exactly one of them carries the fee.
    await signIn();
    const gb = await hatian();
    const campaign = await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });

    await POST(checkoutRequest([
      { kind: 'group_buy', refId: gb.id, qty: 1 },
      { kind: 'moq_campaign', refId: campaign.id, qty: 1 },
    ]));

    const gated = (await placed()).filter((o) => o.cycleKey != null);
    expect(gated).toHaveLength(2);
    expect(gated.filter((o) => Number(o.packingFeePhp) > 0)).toHaveLength(1);
  });

  it('charges the cycle fee again in the next cycle', async () => {
    // A cycle is a period, not a lifetime waiver.
    await signIn();
    const first = await hatian();
    await POST(checkoutRequest([{ kind: 'group_buy', refId: first.id, qty: 1 }]));

    // Move the schedule so the cycle this checkout lands in is a different one.
    const { setScheduleRecurrence } = await import('@/lib/settings');
    const { phtCalendarDate } = await import('@/lib/schedule');
    const today = phtCalendarDate(new Date()).weekday;
    await setScheduleRecurrence({
      openDay: today, openTime: '00:01', closeDay: today, closeTime: '00:00',
    });

    const second = await hatian();
    await POST(checkoutRequest([{ kind: 'group_buy', refId: second.id, qty: 1 }]));

    const [, two] = await placed();
    expect(Number(two.packingFeePhp)).toBe(150);
  });
});

describe('the cycle fee is the boards\' own', () => {
  it('is not satisfied by an on-hand order', async () => {
    // On-hand stock ships as its own parcel on its own schedule, so its fee
    // pays for that parcel and not for the cycle's.
    await signIn();
    const p = await makeProduct({ isOnHand: true, onHandPiecePhp: 1200, stock: 10 });
    const gb = await hatian();

    await POST(checkoutRequest([{ kind: 'product', refId: p.id, qty: 1 }]));
    await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 1 }]));

    const [solo, kahatiOrder] = await placed();
    expect(Number(solo.packingFeePhp)).toBe(PACKING_FEE_PHP.solo);
    expect(Number(kahatiOrder.packingFeePhp)).toBe(150);
  });

  it('is not shared between two customers', async () => {
    const gb = await hatian();
    await signIn();
    await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 1 }]));

    await signIn(); // a different customer, same cycle, same hatian
    await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 1 }]));

    const [one, two] = await placed();
    expect(Number(one.packingFeePhp)).toBe(150);
    expect(Number(two.packingFeePhp)).toBe(150);
  });
});
