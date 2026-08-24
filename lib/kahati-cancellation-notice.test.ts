// The email a customer gets when their hatian never filled.
//
// It is the only notice they receive about money they already sent, and it is
// sent AFTER the cancellation is committed — so anything that can stop it from
// going out leaves a cancelled order and a silent customer. Two things could:
// the wording, which was being borrowed from the pre-commitment screens, and
// the settings read that produces it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KahatiDownpaymentPolicy } from './kahati-downpayment';
import { DEFAULT_KAHATI_DOWNPAYMENT_POLICY } from './kahati-downpayment';

const sent: Array<{ to: string; subject: string; html: string }> = [];
vi.mock('./email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./email')>()),
  // The real templates, so the assertions read the body a customer would.
  sendEmail: vi.fn(async (m: { to: string; subject: string; html: string }) => { sent.push(m); }),
}));

const readPolicy = vi.fn<() => Promise<KahatiDownpaymentPolicy>>();
vi.mock('./settings', () => ({ getKahatiDownpaymentPolicy: () => readPolicy() }));
vi.mock('./posthog', () => ({ captureEvent: vi.fn(async () => {}) }));

const { notifyKahatiCancellations } = await import('./kahati-server');

const notice = (over: Record<string, unknown> = {}) => ({
  userId: 'u1', name: 'Ana Cruz', email: 'ana@example.com',
  orderId: 'o1', orderNo: 'BBG-1001',
  kahatiId: 'k1', kahatiName: 'Reta 10mg', claimedSlots: 3, downpayment: 500,
  ...over,
} as Parameters<typeof notifyKahatiCancellations>[0][number]);

const policy = (over: Partial<KahatiDownpaymentPolicy> = {}): KahatiDownpaymentPolicy =>
  ({ ...DEFAULT_KAHATI_DOWNPAYMENT_POLICY, ...over });

beforeEach(() => {
  sent.length = 0;
  readPolicy.mockReset();
  readPolicy.mockResolvedValue(policy());
});

describe('the cancellation email under a non-refundable policy', () => {
  it('does not tell the customer their deposit is forfeited "once the kahati is confirmed"', async () => {
    // It never was confirmed — that is why this email exists. The
    // pre-commitment sentence states a condition that did not happen.
    readPolicy.mockResolvedValue(policy({ refundable: false }));

    await notifyKahatiCancellations([notice()]);

    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toMatch(/once the kahati is confirmed/i);
  });
});

describe('the cancellation email under the default refundable policy', () => {
  it('keeps the one actionable thing it can say: where the money goes and when', async () => {
    await notifyKahatiCancellations([notice()]);

    expect(sent[0].html).toMatch(/account you paid from/i);
    expect(sent[0].html).toMatch(/banking day/i);
  });
});

describe('when the settings read fails', () => {
  it('still sends every cancellation notice', async () => {
    // The cancellations are already committed by the time this runs. A
    // transient database failure on one settings read must not turn "your
    // hatian was cancelled" into silence for the whole batch.
    readPolicy.mockRejectedValue(new Error('connection terminated unexpectedly'));

    await notifyKahatiCancellations([notice(), notice({ orderNo: 'BBG-1002', email: 'bea@example.com' })]);

    expect(sent.map((m) => m.to)).toEqual(['ana@example.com', 'bea@example.com']);
  });

  it('falls back to the refund promise the storefront has always made', async () => {
    readPolicy.mockRejectedValue(new Error('connection terminated unexpectedly'));

    await notifyKahatiCancellations([notice()]);

    expect(sent[0].html).toMatch(/refunded/i);
  });
});

describe('a sweep that cancelled nothing', () => {
  it('does not read the policy at all', async () => {
    await notifyKahatiCancellations([]);

    expect(readPolicy).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
