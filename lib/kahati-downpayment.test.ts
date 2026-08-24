import { describe, it, expect } from 'vitest';
import {
  collectedAmountLabel,
  DEFAULT_KAHATI_DOWNPAYMENT_POLICY,
  describeKahatiDownpayment,
  isDownpaymentWaivableByCycle,
  kahatiDownpaymentDue,
  parseKahatiDownpaymentPolicy,
  refundNoticeFor,
  cancellationRefundNoticeFor,
  type KahatiDownpaymentPolicy,
} from './kahati-downpayment';

const policy = (over: Partial<KahatiDownpaymentPolicy> = {}): KahatiDownpaymentPolicy =>
  ({ ...DEFAULT_KAHATI_DOWNPAYMENT_POLICY, ...over });

describe('kahatiDownpaymentDue', () => {
  it('charges the packing fee under the default policy', () => {
    // Arrange
    const p = policy();
    // Act
    const due = kahatiDownpaymentDue(p, { subtotal: 4000, packingFee: 150 });
    // Assert
    expect(due).toBe(150);
  });

  it('charges the configured flat amount under the fixed policy', () => {
    const p = policy({ mode: 'fixed', amountPhp: 500 });
    expect(kahatiDownpaymentDue(p, { subtotal: 4000, packingFee: 150 })).toBe(500);
  });

  it('charges a percentage of the order total under the percent policy', () => {
    const p = policy({ mode: 'percent', percent: 20 });
    // 20% of (4000 + 150)
    expect(kahatiDownpaymentDue(p, { subtotal: 4000, packingFee: 150 })).toBe(830);
  });

  it('rounds a percentage to centavos rather than emitting a fraction', () => {
    const p = policy({ mode: 'percent', percent: 33 });
    expect(kahatiDownpaymentDue(p, { subtotal: 1000, packingFee: 0 })).toBe(330);
    expect(kahatiDownpaymentDue(p, { subtotal: 101, packingFee: 0 })).toBe(33.33);
  });

  it('never asks for more than the order is worth', () => {
    // A ₱5,000 flat downpayment against a ₱900 order would collect more than the
    // customer owes and create the very refund this feature exists to avoid.
    const p = policy({ mode: 'fixed', amountPhp: 5000 });
    expect(kahatiDownpaymentDue(p, { subtotal: 750, packingFee: 150 })).toBe(900);
  });

  it('never returns a negative amount', () => {
    const p = policy({ mode: 'fixed', amountPhp: -100 });
    expect(kahatiDownpaymentDue(p, { subtotal: 1000, packingFee: 0 })).toBe(0);
  });

  it('reads an unusable configured figure as nothing due rather than NaN', () => {
    const p = policy({ mode: 'percent', percent: Number.NaN });
    expect(kahatiDownpaymentDue(p, { subtotal: 1000, packingFee: 0 })).toBe(0);
  });

  it('charges nothing on an empty order', () => {
    const p = policy({ mode: 'fixed', amountPhp: 500 });
    expect(kahatiDownpaymentDue(p, { subtotal: 0, packingFee: 0 })).toBe(0);
  });
});

describe('isDownpaymentWaivableByCycle', () => {
  it('waives the packing-fee downpayment, which is a per-cycle parcel charge', () => {
    expect(isDownpaymentWaivableByCycle(policy())).toBe(true);
  });

  it('does not waive a real deposit — it secures THIS kit, not this week', () => {
    expect(isDownpaymentWaivableByCycle(policy({ mode: 'fixed', amountPhp: 500 }))).toBe(false);
    expect(isDownpaymentWaivableByCycle(policy({ mode: 'percent', percent: 20 }))).toBe(false);
  });
});

describe('describeKahatiDownpayment', () => {
  it('names the flat amount', () => {
    expect(describeKahatiDownpayment(policy({ mode: 'fixed', amountPhp: 500 }))).toBe('₱500 per kahati order');
  });

  it('names the percentage', () => {
    expect(describeKahatiDownpayment(policy({ mode: 'percent', percent: 20 }))).toBe('20% of the order total');
  });

  it('names the packing fee', () => {
    expect(describeKahatiDownpayment(policy())).toBe('the packing fee for the cycle');
  });
});

describe('refundNoticeFor', () => {
  it('promises the refund when the downpayment is refundable', () => {
    expect(refundNoticeFor(policy({ refundable: true }))).toMatch(/refunded/i);
  });

  it('says the downpayment is forfeited when the policy is non-refundable', () => {
    expect(refundNoticeFor(policy({ refundable: false }))).toMatch(/non-refundable/i);
  });

  it('prefers the admin own wording when one is configured', () => {
    const note = 'Downpayments roll over to your next hatian.';
    expect(refundNoticeFor(policy({ policyNote: note }))).toBe(note);
  });
});

// The same policy, read out AFTER the kit has fallen through. refundNoticeFor
// is written for the screens where the customer has not committed yet, so its
// sentences are conditional ("if the kahati is cancelled…") or forward-looking
// ("…once the kahati is confirmed") — both wrong in the email that announces
// the cancellation, the second actively so.
describe('cancellationRefundNoticeFor', () => {
  it('states the refund as something that is happening, not something that might', () => {
    const notice = cancellationRefundNoticeFor(policy({ refundable: true }));

    expect(notice).toMatch(/refunded/i);
    expect(notice).not.toMatch(/if the kahati is cancelled/i);
  });

  it('tells the customer where the money goes back to and how long it takes', () => {
    // The one actionable thing this email can say. It was the historical copy
    // and it must survive the policy becoming configurable.
    const notice = cancellationRefundNoticeFor(policy({ refundable: true }));

    expect(notice).toMatch(/account you paid from/i);
    expect(notice).toMatch(/banking day/i);
  });

  it('never says the deposit is forfeited "once the kahati is confirmed"', () => {
    // This kahati was never confirmed — it was cancelled. Quoting the
    // pre-commitment terms here tells the customer their money is gone on a
    // condition that did not happen.
    const notice = cancellationRefundNoticeFor(policy({ refundable: false }));

    expect(notice).not.toMatch(/once the kahati is confirmed/i);
  });

  it('says plainly that a non-refundable deposit is not coming back', () => {
    const notice = cancellationRefundNoticeFor(policy({ refundable: false }));

    expect(notice).toMatch(/not.*refund|non-refundable/i);
  });

  it('ignores the storefront policy note, which is written for the screens before the commit', () => {
    // "Non-refundable once the kahati is confirmed." is a perfectly good note
    // on the checkout card and a false statement in this email.
    const note = 'This downpayment is non-refundable once the kahati is confirmed.';

    expect(cancellationRefundNoticeFor(policy({ refundable: true, policyNote: note }))).not.toBe(note);
  });
});

describe('collectedAmountLabel', () => {
  it('calls a collection equal to the packing fee what it is', () => {
    expect(collectedAmountLabel(150, 150)).toBe('Packing fee paid');
  });

  it('calls anything else a downpayment', () => {
    expect(collectedAmountLabel(500, 150)).toBe('Downpayment paid');
  });

  it('tolerates a centavo of rounding', () => {
    expect(collectedAmountLabel(150.004, 150)).toBe('Packing fee paid');
  });
});

describe('parseKahatiDownpaymentPolicy', () => {
  it('falls back to the default policy when nothing is stored', () => {
    expect(parseKahatiDownpaymentPolicy({})).toEqual(DEFAULT_KAHATI_DOWNPAYMENT_POLICY);
  });

  it('reads stored strings back into a typed policy', () => {
    expect(parseKahatiDownpaymentPolicy({
      kahati_downpayment_mode: 'percent',
      kahati_downpayment_percent: '25',
      kahati_downpayment_amount: '500',
      kahati_downpayment_refundable: 'false',
      kahati_downpayment_note: 'Forfeited if you back out.',
    })).toEqual({
      mode: 'percent', percent: 25, amountPhp: 500,
      refundable: false, policyNote: 'Forfeited if you back out.',
    });
  });

  it('fails back to the packing fee on an unrecognised mode', () => {
    // An unknown mode must not leave the checkout unable to quote a downpayment.
    expect(parseKahatiDownpaymentPolicy({ kahati_downpayment_mode: 'bananas' }).mode).toBe('packing_fee');
  });

  it('treats a refundable downpayment as the default', () => {
    expect(parseKahatiDownpaymentPolicy({}).refundable).toBe(true);
  });
});
