// PostHog events on order status changes. A PostHog destination sends the
// customer's Gmail off the back of these, so a missing event = a missing email.
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
  return { ApiError, getSession: async () => session.current, requireSession, requireAdmin: requireSession };
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

const { PATCH } = await import('./route');
const { POST: placeOrder } = await import('@/app/api/orders/route');
const { resetDb, makeUser, makeProduct, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');

async function placeAnOrder() {
  const user = await makeUser();
  session.current = { sub: user.id, role: 'customer', email: user.email };
  const product = await makeProduct({ stock: 50 });
  const res = await placeOrder(checkoutRequest([{ kind: 'product', refId: product.id, qty: 2, unit: 'piece' }]));
  const body = await res.json();
  return { user, order: body.data.order as { id: string; orderNo: string } };
}

const patch = (id: string, body: Record<string, unknown>) =>
  PATCH(
    new Request(`http://localhost/api/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const eventsNamed = (name: string): Captured[] =>
  captureEvent.mock.calls.map((c) => c[0]).filter((p) => p.event === name);

beforeEach(async () => {
  session.current = null;
  captureEvent.mockClear();
  await resetDb();
});

describe('order status events', () => {
  it('emits order_placed at checkout', async () => {
    const { user, order } = await placeAnOrder();

    const [payload] = eventsNamed('order_placed');
    expect(payload).toBeTruthy();
    expect(payload.distinctId).toBe(user.id);
    expect(payload.email).toBe(user.email);
    expect(payload.properties.orderNo).toBe(order.orderNo);
  });

  it('emits a status-specific event when the admin confirms payment', async () => {
    const { order } = await placeAnOrder();
    captureEvent.mockClear();

    await patch(order.id, { status: 'payment_confirmed' });

    expect(eventsNamed('order_payment_confirmed')).toHaveLength(1);
  });

  it('emits order_shipped with the tracking number the email needs', async () => {
    const { order } = await placeAnOrder();
    captureEvent.mockClear();

    await patch(order.id, { status: 'shipped', trackingNo: 'JT-12345' });

    const [{ properties: props }] = eventsNamed('order_shipped');
    expect(props.trackingNo).toBe('JT-12345');
    expect(props.orderNo).toBe(order.orderNo);
    expect(props.status).toBe('shipped');
  });

  it('addresses the event to the customer, not the admin making the change', async () => {
    const { user, order } = await placeAnOrder();
    const admin = await makeUser({ role: 'admin' });
    session.current = { sub: admin.id, role: 'admin', email: admin.email };
    captureEvent.mockClear();

    await patch(order.id, { status: 'delivered' });

    const [payload] = eventsNamed('order_delivered');
    expect(payload.email).toBe(user.email);
    expect(payload.distinctId).toBe(user.id);
  });

  it('emits order_cancelled when an order is cancelled', async () => {
    const { order } = await placeAnOrder();
    captureEvent.mockClear();

    await patch(order.id, { status: 'cancelled' });

    expect(eventsNamed('order_cancelled')).toHaveLength(1);
  });

  it('does not emit when the status update is rejected', async () => {
    const { order } = await placeAnOrder();
    captureEvent.mockClear();

    const res = await patch(order.id, { status: 'not_a_status' });

    expect(res.status).toBe(400);
    expect(captureEvent).not.toHaveBeenCalled();
  });
});

describe('kahati cancellation events', () => {
  it('emits kahati_cancelled for each participant of a failed hatian', async () => {
    const { sweepExpiredKahatis } = await import('@/lib/kahati-server');
    const { getDb, groupBuys } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');

    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, name: 'Reta Hatian' });
    const user = await makeUser();
    session.current = { sub: user.id, role: 'customer', email: user.email };
    await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }]));

    const db = await getDb();
    await db.update(groupBuys).set({ closesAt: new Date(Date.now() - 86_400_000) }).where(eq(groupBuys.id, gb.id));
    captureEvent.mockClear();

    await sweepExpiredKahatis(db);

    const [payload] = eventsNamed('kahati_cancelled');
    expect(payload).toBeTruthy();
    expect(payload.email).toBe(user.email);
    expect(payload.properties.kahatiName).toBe('Reta Hatian');
    // The refund amount is what the customer actually cares about.
    expect(payload.properties.refundPhp).toBeGreaterThan(0);
  });
});
