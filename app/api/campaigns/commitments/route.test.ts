// What the cart asks before it decides whether to SHOW a packing fee.
//
// The charge itself is covered by app/api/orders/packing-fee-cycle.test.ts.
// This is the other half of the same promise: the customer is told a number
// before they are charged one, and the two are only guaranteed to agree because
// both read through listCyclePayments. Nothing pinned that until now, so the
// preview could have drifted from the charge without a single test failing —
// and a cart that shows a fee the checkout does not collect (or the reverse) is
// exactly the complaint this endpoint exists to prevent.
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

const { GET } = await import('./route');
const { POST: placeOrder } = await import('../../orders/route');
const {
  resetDb, openBoards, closeBoards, makeUser, makeGroupBuy, makeProduct,
  checkoutRequest, commitRequest, makeMoqCampaign,
} = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const paidThisCycle = async (): Promise<boolean> =>
  (await (await GET()).json()).data.paidThisCycle;

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('GET /api/campaigns/commitments — packing fee already paid?', () => {
  // The cart is local and both boards are public, so a signed-out browse is an
  // ordinary state, not an error.
  it('reports nothing owed for a signed-out visitor rather than failing', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data.paidThisCycle).toBe(false);
  });

  it('is false for a customer who has ordered nothing this cycle', async () => {
    await signIn();
    expect(await paidThisCycle()).toBe(false);
  });

  // The client's report: a customer who already has a group buy order this
  // cycle should not be shown the packing fee again.
  it('is true once the customer has an existing group buy order this cycle', async () => {
    await signIn();
    const campaign = await makeMoqCampaign();

    expect(await paidThisCycle()).toBe(false);
    const res = await placeOrder(commitRequest(campaign.id, 1));
    expect(res.ok).toBe(true);

    expect(await paidThisCycle()).toBe(true);
  });

  // The fee buys a PARCEL and the two boards ship one, so a hatian order has to
  // satisfy the group buy board's fee too — this is the group buy endpoint
  // answering for a hatian purchase.
  it('carries the waiver across from the hatian board to this one', async () => {
    await signIn();
    const kahati = await makeGroupBuy();

    // The counter's own minimum — a smaller commitment is refused outright.
    await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: kahati.minVials }]));

    expect(await paidThisCycle()).toBe(true);
  });

  // An on-hand order ships as its own parcel on its own timing, so its fee pays
  // for that parcel and not for the cycle's.
  it('is not satisfied by an on-hand order', async () => {
    await signIn();
    const product = await makeProduct({ stock: 50 });

    await placeOrder(checkoutRequest([{ kind: 'product', refId: product.id, qty: 1, unit: 'piece' }]));

    expect(await paidThisCycle()).toBe(false);
  });

  it('does not leak one customer waiver to another', async () => {
    const campaign = await makeMoqCampaign();
    await signIn();
    await placeOrder(commitRequest(campaign.id, 1));
    expect(await paidThisCycle()).toBe(true);

    await signIn(); // a different customer
    expect(await paidThisCycle()).toBe(false);
  });

  // No open cycle means no parcel to have paid for. The boards being shut is
  // not the same as the fee being settled.
  it('is false while both boards are closed', async () => {
    await signIn();
    const campaign = await makeMoqCampaign();
    await placeOrder(commitRequest(campaign.id, 1));
    expect(await paidThisCycle()).toBe(true);

    await closeBoards();
    expect(await paidThisCycle()).toBe(false);
  });
});
