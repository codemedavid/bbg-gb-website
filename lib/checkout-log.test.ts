// Diagnostics for the checkout path.
//
// Every bug in this audit had to be found by reading code and querying the
// production database, because the checkout path emitted nothing. There was no
// way to answer "how often does this actually happen", "which customers hit
// it", or "did the fix work" — the ₱0 report and the "cart disappeared" report
// both stayed guesses far longer than they needed to.
//
// The other half of the requirement matters as much: these lines go to a
// hosting provider's log drain, so they must carry identifiers and never carry
// the customer. A log that leaks an address is worse than no log.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkoutLog, CHECKOUT_EVENTS } from '@/lib/checkout-log';

let logged: string[] = [];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = [];
  spy = vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});
afterEach(() => spy.mockRestore());

const parsed = () => logged.map((l) => JSON.parse(l.replace(/^\[checkout\]\s*/, '')));

describe('what a checkout event records', () => {
  it('names the event and the order it is about', () => {
    checkoutLog('order_created', { userId: 'u-1', orderId: 'o-9', orderNo: 'KH-2424' });

    expect(logged).toHaveLength(1);
    const [entry] = parsed();
    expect(entry.event).toBe('order_created');
    expect(entry.orderId).toBe('o-9');
    expect(entry.orderNo).toBe('KH-2424');
    expect(entry.userId).toBe('u-1');
  });

  it('is one machine-readable line, so a log drain can filter it', () => {
    checkoutLog('checkout_started', { userId: 'u-1', itemCount: 3 });
    expect(logged[0].startsWith('[checkout] ')).toBe(true);
    expect(() => JSON.parse(logged[0].replace('[checkout] ', ''))).not.toThrow();
    expect(logged[0]).not.toContain('\n');
  });

  it('timestamps every entry', () => {
    checkoutLog('checkout_started', { userId: 'u-1' });
    expect(typeof parsed()[0].at).toBe('string');
  });

  it('covers the lifecycle the client asked to be able to trace', () => {
    // Named as a set so a new call site cannot invent a fifth spelling of
    // "the order failed" and make the logs unfilterable.
    expect([...CHECKOUT_EVENTS].sort()).toEqual([
      'cart_cleared',
      'checkout_started',
      'checkout_validation_failed',
      'order_created',
      'order_creation_failed',
      'order_creation_started',
      // The other end of the same story: a checkout takes money in, closing a
      // Pasalo decides what goes back out, and marking a refund records that
      // it did. Traced in the same drain because "why did this customer get
      // ₱550" is asked six weeks later, alongside "what did they pay".
      'pasalo_stage_closed',
      'payment_proof_uploaded',
      'payment_status_changed',
      'price_changed_mid_checkout',
      'refund_status_changed',
    ]);
  });
});

describe('what a checkout event must never record', () => {
  it('drops customer identity and delivery details', () => {
    checkoutLog('order_created', {
      userId: 'u-1',
      orderNo: 'KH-1',
      // Everything a caller might absent-mindedly spread in from the request body.
      shipName: 'Juan dela Cruz',
      shipPhone: '09171234567',
      shipAddress: '12 Real Street, Manila',
      email: 'juan@example.com',
      password: 'hunter2',
      token: 'eyJhbGciOi',
      idempotencyKey: 'abc-123',
    } as never);

    const line = logged[0];
    for (const secret of [
      'Juan dela Cruz', '09171234567', '12 Real Street', 'juan@example.com',
      'hunter2', 'eyJhbGciOi', 'abc-123',
    ]) {
      expect(line).not.toContain(secret);
    }
    // …while still being useful.
    expect(parsed()[0].orderNo).toBe('KH-1');
    expect(parsed()[0].userId).toBe('u-1');
  });

  it('keeps money and counts, which are the whole point of the log', () => {
    checkoutLog('order_created', {
      userId: 'u-1', orderNo: 'KH-1', totalPhp: 1812.5, itemCount: 2,
      paymentStatus: 'not_due', buyType: 'kahati',
    });
    const entry = parsed()[0];
    expect(entry.totalPhp).toBe(1812.5);
    expect(entry.itemCount).toBe(2);
    expect(entry.paymentStatus).toBe('not_due');
    expect(entry.buyType).toBe('kahati');
  });

  it('never throws, whatever it is handed', () => {
    // A logger that can break a checkout is worse than no logger. This is the
    // same lesson as the php() ₱0 fallback, learned in the other direction.
    const circular: Record<string, unknown> = { userId: 'u-1' };
    circular.self = circular;
    expect(() => checkoutLog('order_created', circular as never)).not.toThrow();
  });
});
