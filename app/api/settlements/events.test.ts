// PostHog events on the hatian final checkout. A PostHog destination sends the
// customer's Gmail off the back of these, so a missing event = a missing email
// and a missing property = an email that cannot say what it needs to say.
//
// route.test.ts already pins the same guarantees for the app's own SMTP mail.
// These pin them for the PostHog path, which is the one that actually delivers.
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

type Captured = {
  event: string; distinctId: string; email: string; name?: string;
  properties: Record<string, unknown>;
};
const captureEvent = vi.fn(async (_input: Captured) => {});
vi.mock('@/lib/posthog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/posthog')>('@/lib/posthog');
  return { ...actual, captureEvent };
});

const { POST } = await import('./route');
const { POST: CHECKOUT } = await import('../orders/route');
const { resetDb, openBoards, makeUser, makeGroupBuy, checkoutRequest, settlementRequest } =
  await import('@/lib/test/harness');
const { getDb, groupBuys } = await import('@/lib/db');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

// Commit `qty` vials to a fresh hatian, then close it so the commitment is
// ready to settle. Mirrors the helper in route.test.ts.
async function committedAndClosedHatian(qty = 3): Promise<string> {
  const gb = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, repackFeePhp: 150, totalSlots: 100 });
  const res = await CHECKOUT(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty }]));
  expect(res.status).toBe(201);
  const db = await getDb();
  await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, gb.id));
  return gb.id;
}

const eventsNamed = (name: string): Captured[] =>
  captureEvent.mock.calls.map((c) => c[0]).filter((p) => p.event === name);

beforeEach(async () => {
  session.current = null;
  captureEvent.mockClear();
  await resetDb();
  await openBoards();
});

describe('settlement events', () => {
  it('emits settlement_placed when the final checkout succeeds', async () => {
    const user = await signIn();
    await committedAndClosedHatian(3);

    await POST(settlementRequest());

    const [event] = eventsNamed('settlement_placed');
    expect(event).toBeTruthy();
    expect(event.distinctId).toBe(user.id);
    expect(event.email).toBe(user.email);
  });

  it('carries the name so the email greets the customer, not their email address', async () => {
    // The app's own mail already does this (route.test.ts, "greets the customer
    // by name"). PostHog resolves the greeting from `name`, so without it the
    // destination falls back to the address and sends "Salamat, ana@example.com!"
    // — the mailing-list blast the route comment warns about.
    await signIn();
    await committedAndClosedHatian(3);

    await POST(settlementRequest());

    const [event] = eventsNamed('settlement_placed');
    expect(event.name).toBe('Test User'); // the name on the account
  });

  it('carries the totals the email has to state', async () => {
    await signIn();
    await committedAndClosedHatian(3);

    await POST(settlementRequest());

    const [event] = eventsNamed('settlement_placed');
    expect(event.properties).toMatchObject({ orderCount: 1 });
    expect(Number(event.properties.totalPhp)).toBeGreaterThan(0);
  });

  it('does not emit when the settlement is rejected', async () => {
    await signIn();

    const res = await POST(settlementRequest()); // nothing ready to settle

    expect(res.status).toBe(400);
    expect(eventsNamed('settlement_placed')).toHaveLength(0);
  });
});
