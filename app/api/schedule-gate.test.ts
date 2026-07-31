// Group Buy and Hatian open and close TOGETHER, on one admin-configured window.
//
// The requirement is not "each board has a schedule" — it is that there is one
// schedule and neither board can be live without the other. So every test here
// asserts on BOTH endpoints in the same breath: a change that gates one and
// forgets the other fails, which is the failure mode a per-board test would miss.
//
// The second thing pinned here is subtler. The admin campaigns list reads the
// PUBLIC GET /api/campaigns (lib/admin-api.ts useCampaigns), so gating that
// route naively locks the admin out of their own campaigns the moment the
// storefront closes — they could never open the next window. Admins read
// through; customers and anonymous visitors do not.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const getSession = async () => session.current;
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError, getSession, requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { GET: LIST_HATIAN } = await import('./groupbuys/route');
const { GET: LIST_CAMPAIGNS } = await import('./campaigns/route');
const { POST: CHECKOUT } = await import('./orders/route');
const { setGroupBuySchedule } = await import('@/lib/settings');
const {
  resetDb, makeUser, makeGroupBuy, makeMoqCampaign, makePaymentMethod, commitRequest, checkoutRequest,
} = await import('@/lib/test/harness');

const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

/** A window that contains this instant. */
const openNow = () => setGroupBuySchedule({ opensAt: iso(-HOUR), closesAt: iso(HOUR) });
/** A window that has already elapsed. */
const closedNow = () => setGroupBuySchedule({ opensAt: iso(-2 * HOUR), closesAt: iso(-HOUR) });

beforeEach(async () => {
  await resetDb();
  session.current = null;
});

async function signIn(role: 'customer' | 'admin' = 'customer') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

describe('the shared schedule gates both boards together', () => {
  it('serves both boards while the window is open', async () => {
    await openNow();
    await makeGroupBuy({ name: 'Open hatian' });
    await makeMoqCampaign();

    const hatian = await LIST_HATIAN();
    const campaigns = await LIST_CAMPAIGNS();

    expect(hatian.status).toBe(200);
    expect(campaigns.status).toBe(200);
    expect((await hatian.json()).data).toHaveLength(1);
    expect((await campaigns.json()).data).toHaveLength(1);
  });

  it('hides both boards once the window has closed', async () => {
    await closedNow();
    await makeGroupBuy({ name: 'Open hatian' });
    await makeMoqCampaign();

    expect((await LIST_HATIAN()).status).toBe(404);
    expect((await LIST_CAMPAIGNS()).status).toBe(404);
  });

  it('hides both boards when no schedule has ever been configured', async () => {
    // Fails closed. An unconfigured deploy shows nothing rather than everything.
    await makeGroupBuy({ name: 'Open hatian' });
    await makeMoqCampaign();

    expect((await LIST_HATIAN()).status).toBe(404);
    expect((await LIST_CAMPAIGNS()).status).toBe(404);
  });

  it('never leaves one board open while the other is shut', async () => {
    // The whole point of the feature, stated as one assertion.
    await closedNow();
    const hatianOpen = (await LIST_HATIAN()).status === 200;
    const campaignsOpen = (await LIST_CAMPAIGNS()).status === 200;
    expect(hatianOpen).toBe(campaignsOpen);

    await openNow();
    const hatianOpen2 = (await LIST_HATIAN()).status === 200;
    const campaignsOpen2 = (await LIST_CAMPAIGNS()).status === 200;
    expect(hatianOpen2).toBe(campaignsOpen2);
  });
});

describe('the admin is never locked out by the schedule', () => {
  it('lets an admin read the campaign list while the storefront is closed', async () => {
    // The admin list shares this endpoint. Without the bypass, closing the
    // window would hide the campaigns from the very screen used to reopen it.
    await closedNow();
    await makeMoqCampaign();
    await signIn('admin');

    const res = await LIST_CAMPAIGNS();

    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  it('still hides the closed board from a signed-in customer', async () => {
    // Being logged in is not the same as being an admin.
    await closedNow();
    await makeMoqCampaign();
    await signIn('customer');

    expect((await LIST_CAMPAIGNS()).status).toBe(404);
  });
});

describe('checkout respects the schedule', () => {
  it('refuses a group buy commitment placed after the window closed', async () => {
    // A cart left open across the close must not still check out — the board
    // being hidden is presentation; this is the rule.
    await openNow();
    const campaign = await makeMoqCampaign({ moq: 10 });
    await makePaymentMethod();
    await signIn('customer');
    await closedNow();

    const res = await CHECKOUT(commitRequest(campaign.id, 1, { idempotencyKey: 'late-commit' }));

    expect(res.status).toBe(409);
  });

  it('refuses a hatian commitment placed after the window closed', async () => {
    await openNow();
    const hatian = await makeGroupBuy({ totalSlots: 10, minVials: 1 });
    await makePaymentMethod();
    await signIn('customer');
    await closedNow();

    const res = await CHECKOUT(checkoutRequest(
      [{ kind: 'group_buy', refId: hatian.id, qty: 1 }],
      { idempotencyKey: 'late-hatian' },
    ));

    expect(res.status).toBe(409);
  });

  it('still accepts an ordinary shop order while the boards are closed', async () => {
    // The schedule governs Group Buy and Hatian only. Closing them must not
    // take the on-hand shop down with them.
    await closedNow();
    const { makeProduct } = await import('@/lib/test/harness');
    const product = await makeProduct({ stock: 10 });
    await makePaymentMethod();
    await signIn('customer');

    const res = await CHECKOUT(checkoutRequest(
      [{ kind: 'product', refId: product.id, qty: 1, mode: 'piece' }],
      { idempotencyKey: 'shop-order' },
    ));

    expect(res.status).toBe(201);
  });
});
