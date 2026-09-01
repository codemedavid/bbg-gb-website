// Server-side PostHog capture. PostHog owns the customer emails now — a
// destination listens for each order event and sends the Gmail — so a dropped or
// malformed event means a customer never hears from us. It must therefore carry
// the recipient, and it must never throw into the checkout/admin paths it sits in.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const capture = vi.fn();
const flush = vi.fn(async () => {});
const ctor = vi.fn();
vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(key: string, opts: unknown) { ctor(key, opts); }
    capture = capture;
    flush = flush;
  },
}));

const fakeEnv = { posthogKey: '', posthogHost: 'https://us.i.posthog.com' };
vi.mock('./env', () => ({ env: fakeEnv }));

const { captureEvent, orderStatusEvent, ORDER_STATUS_EVENT } = await import('./posthog');

const input = () => ({
  event: 'order_shipped',
  distinctId: 'user-1',
  email: 'ana@example.com',
  name: 'Ana Cruz',
  properties: { orderNo: 'BBG-2500', status: 'shipped' },
});

beforeEach(() => {
  capture.mockReset(); flush.mockReset(); ctor.mockReset();
  flush.mockResolvedValue(undefined);
  fakeEnv.posthogKey = '';
  // The module memoises its client; drop it between tests.
  vi.resetModules();
});

describe('captureEvent', () => {
  it('does nothing when POSTHOG_KEY is unset', async () => {
    const { captureEvent: fn } = await import('./posthog');

    await fn(input());

    expect(ctor).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('sends the event once a key is configured', async () => {
    fakeEnv.posthogKey = 'phc_test';
    const { captureEvent: fn } = await import('./posthog');

    await fn(input());

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toMatchObject({
      distinctId: 'user-1',
      event: 'order_shipped',
    });
  });

  it('carries the recipient address so PostHog can address the email', async () => {
    fakeEnv.posthogKey = 'phc_test';
    const { captureEvent: fn } = await import('./posthog');

    await fn(input());

    const props = capture.mock.calls[0][0].properties;
    expect(props.email).toBe('ana@example.com');
    expect(props.orderNo).toBe('BBG-2500');
  });

  it('sets the email on the person so a PostHog destination can resolve them', async () => {
    fakeEnv.posthogKey = 'phc_test';
    const { captureEvent: fn } = await import('./posthog');

    await fn(input());

    expect(capture.mock.calls[0][0].properties.$set).toMatchObject({
      email: 'ana@example.com', name: 'Ana Cruz',
    });
  });

  it('flushes immediately — serverless invocations do not live long enough to batch', async () => {
    fakeEnv.posthogKey = 'phc_test';
    const { captureEvent: fn } = await import('./posthog');

    await fn(input());

    expect(flush).toHaveBeenCalled();
  });

  it('never throws when PostHog is unreachable — analytics must not break an order', async () => {
    fakeEnv.posthogKey = 'phc_test';
    flush.mockRejectedValue(new Error('network down'));
    const { captureEvent: fn } = await import('./posthog');

    await expect(fn(input())).resolves.toBeDefined();
  });
});

// PostHog is the delivery mechanism, so the capture IS the send. A caller that
// cannot tell whether it succeeded cannot write a truthful email_log row, which
// is how 144 undelivered password resets came to look like 144 delivered ones.
// Reporting the outcome must not turn a PostHog outage into a thrown error.
describe('captureEvent outcome', () => {
  it('reports success once the event has flushed', async () => {
    fakeEnv.posthogKey = 'phc_test';
    const { captureEvent: fn } = await import('./posthog');

    await expect(fn(input())).resolves.toEqual({ ok: true });
  });

  it('reports the failure and its reason when the flush is rejected', async () => {
    fakeEnv.posthogKey = 'phc_test';
    flush.mockRejectedValue(new Error('network down'));
    const { captureEvent: fn } = await import('./posthog');

    const outcome = await fn(input());

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('network down');
  });

  // Unconfigured is a valid local state, but it is not a delivery. Saying so
  // is what stops a dev-shaped production reading as a working one.
  it('reports not-sent when POSTHOG_KEY is unset', async () => {
    const { captureEvent: fn } = await import('./posthog');

    const outcome = await fn(input());

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/POSTHOG_KEY/i);
  });
});

describe('orderStatusEvent', () => {
  it('gives each order status its own event name', () => {
    expect(orderStatusEvent('payment_confirmed')).toBe('order_payment_confirmed');
    expect(orderStatusEvent('batch_filling')).toBe('order_batch_filling');
    expect(orderStatusEvent('shipped')).toBe('order_shipped');
    expect(orderStatusEvent('delivered')).toBe('order_delivered');
    expect(orderStatusEvent('cancelled')).toBe('order_cancelled');
    expect(orderStatusEvent('proof_review')).toBe('order_proof_review');
  });

  it('covers every status the app can set, so no email silently goes unsent', () => {
    const statuses = ['proof_review', 'payment_confirmed', 'batch_filling', 'shipped', 'delivered', 'cancelled'];
    for (const s of statuses) expect(ORDER_STATUS_EVENT[s]).toBeTruthy();
  });

  it('falls back to a generic name for an unknown status rather than dropping it', () => {
    expect(orderStatusEvent('something_new')).toBe('order_status_changed');
  });
});
