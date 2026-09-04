// What the customer is told when the receipt fails but the order did not.
//
// The route sends the receipt and records the analytics event AFTER the
// transaction commits — rightly, since announcing a rolled-back order is worse.
// But it did so inside the request and awaited both, so anything thrown on the
// way out escaped into the handler, which answered 500 "Something went wrong."
// for orders that were already in the database with stock drawn and kahati slots
// claimed.
//
// The customer reads that as a failed checkout. If they retry in the same tab
// the idempotency key replays and they are fine; if they reload — which is what
// "something went wrong" invites — the page mints a fresh key and they place the
// whole order a second time. A mail server hiccup should not be able to do that.
//
// Delivery is best-effort by design (lib/email.ts records the fate of every
// notification either way, and lib/posthog.ts returns its outcome rather than
// throwing). The order is the thing that has to be reported honestly.
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

// Both notification channels, controllable per test.
const sendEmail = vi.fn(async () => {});
const captureEvent = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: (...args: unknown[]) => sendEmail(...(args as [])),
}));
vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureEvent: (...args: unknown[]) => captureEvent(...(args as [])),
}));

const { POST: placeOrder } = await import('./route');
const { resetDb, makeUser, makeProduct, checkoutRequest } = await import('@/lib/test/harness');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const storedOrders = async () => {
  const { getDb, orders } = await import('@/lib/db');
  return (await getDb()).select().from(orders);
};

const buyOne = async () => {
  const product = await makeProduct({ isOnHand: true, stock: 10, onHandPiecePhp: 550 });
  return placeOrder(checkoutRequest(
    [{ kind: 'product', refId: product.id, qty: 1 }],
    { withProof: true },
  ));
};

beforeEach(async () => {
  session.current = null;
  sendEmail.mockReset().mockResolvedValue(undefined);
  captureEvent.mockReset().mockResolvedValue({ ok: true });
  await resetDb();
});

describe('an order whose receipt could not be sent', () => {
  it('is still reported to the customer as placed', async () => {
    // The order exists. Telling them otherwise is a lie that costs a duplicate.
    await signIn();
    sendEmail.mockRejectedValue(new Error('SMTP unavailable'));

    const res = await buyOne();

    expect(res.status).toBe(201);
  });

  it('returns the order number, so the success screen can name it', async () => {
    await signIn();
    sendEmail.mockRejectedValue(new Error('SMTP unavailable'));

    const res = await buyOne();
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.orderNo).toMatch(/^BBG-\d+$/);
  });

  it('leaves exactly one order behind, not zero and not two', async () => {
    await signIn();
    sendEmail.mockRejectedValue(new Error('SMTP unavailable'));

    await buyOne();

    expect(await storedOrders()).toHaveLength(1);
  });

  it('survives the analytics event failing as well', async () => {
    // PostHog is what actually delivers the mail in production, so a bad day
    // there takes out both channels at once.
    await signIn();
    sendEmail.mockRejectedValue(new Error('SMTP unavailable'));
    captureEvent.mockRejectedValue(new Error('posthog unreachable'));

    const res = await buyOne();

    expect(res.status).toBe(201);
    expect(await storedOrders()).toHaveLength(1);
  });

  it('still attempts the receipt on the happy path', async () => {
    // The failure handling must not have quietly stopped sending anything.
    await signIn();

    const res = await buyOne();

    expect(res.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(captureEvent).toHaveBeenCalled();
  });
});
