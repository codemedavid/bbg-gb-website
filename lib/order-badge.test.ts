// What the customer's own order list says about their order.
//
// This is the screen the client's report is actually about: "customers complete
// checkout and the system immediately shows Payment Confirmed even though the
// customer has NOT uploaded any payment proof". My Orders rendered
// STATUS_LABEL[order.status], `status` was 'payment_confirmed' because the
// fulfilment flow had no word for "owes nothing today", and so the badge said
// the customer's payment had been received and checked.
//
// Now that payment has a field of its own, the badge asks that field during the
// phase where money is the salient fact, and the fulfilment field once the
// parcel starts moving — because "Shipped" is what a customer wants to see on a
// shipped order, not a payment verdict they settled weeks ago.
import { describe, it, expect } from 'vitest';
import { orderBadge } from '@/lib/order-status';

describe('the badge during the payment phase', () => {
  it('does not claim a confirmed payment on an order that owed nothing', () => {
    // The reported bug, as an assertion. This is the 24-row case.
    const badge = orderBadge({ status: 'payment_confirmed', paymentStatus: 'not_due' });

    expect(badge.label).toBe('No Payment Due');
    expect(badge.label).not.toMatch(/confirm/i);
  });

  it('does claim a confirmed payment once an admin has verified one', () => {
    const badge = orderBadge({ status: 'payment_confirmed', paymentStatus: 'confirmed' });
    expect(badge.label).toBe('Payment Confirmed');
  });

  it('tells an uploaded proof apart from one never sent', () => {
    // Both are 'proof_review' as far as fulfilment is concerned, and before this
    // both read "Payment Pending" — so a customer who had uploaded had no way to
    // see that it landed.
    expect(orderBadge({ status: 'proof_review', paymentStatus: 'proof_submitted' }).label)
      .toBe('Proof Submitted');
    expect(orderBadge({ status: 'proof_review', paymentStatus: 'pending' }).label)
      .toBe('Payment Pending');
  });

  it('says so when an admin rejected the payment', () => {
    expect(orderBadge({ status: 'proof_review', paymentStatus: 'rejected' }).label)
      .toBe('Payment Rejected');
  });
});

describe('the badge once the parcel is moving', () => {
  it('reports fulfilment, not a payment verdict already settled', () => {
    expect(orderBadge({ status: 'shipped', paymentStatus: 'confirmed' }).label).toBe('Shipped');
    expect(orderBadge({ status: 'delivered', paymentStatus: 'confirmed' }).label).toBe('Delivered');
    expect(orderBadge({ status: 'batch_filling', paymentStatus: 'not_due' }).label).toBe('Processing');
  });

  it('reports a cancelled order as cancelled whatever the money did', () => {
    expect(orderBadge({ status: 'cancelled', paymentStatus: 'not_due' }).label).toBe('Cancelled');
    expect(orderBadge({ status: 'cancelled', paymentStatus: 'confirmed' }).label).toBe('Cancelled');
  });
});

describe('the badge on a row written before payment had a field', () => {
  it('falls back to deriving the payment state from the proofs the order carries', () => {
    // A legacy row with no payment_status. Confirmed-with-proof is a real
    // verification; confirmed-with-nothing is the confirm-only case, and must
    // not read as one.
    expect(orderBadge({ status: 'payment_confirmed', paymentStatus: null, proofCount: 1 }).label)
      .toBe('Payment Confirmed');
    expect(orderBadge({ status: 'payment_confirmed', paymentStatus: null, proofCount: 0 }).label)
      .toBe('No Payment Due');
  });

  it('never renders an empty badge for a status it has never heard of', () => {
    const badge = orderBadge({ status: 'some_future_state', paymentStatus: null, proofCount: 0 });
    expect(badge.label.length).toBeGreaterThan(0);
  });

  it('always carries a class, so a badge is never invisible', () => {
    for (const status of ['proof_review', 'payment_confirmed', 'shipped', 'cancelled', 'weird']) {
      expect(orderBadge({ status, paymentStatus: null, proofCount: 0 }).className).toBeTruthy();
    }
  });
});

describe('the badge on an order whose balance went through the final checkout', () => {
  // "nawala daw payment" — the customer's report, holding the screenshot of a
  // ₱1,140 payment they had made two days earlier.
  //
  // A hatian order is paid twice: the downpayment at checkout, and the balance
  // at the hatian final checkout, which writes a SETTLEMENT and never touches
  // orders.payment_status. The badge only ever asked the order, so the second
  // payment was invisible on the one screen the customer checks.
  it('does not say nothing is due on an order the customer has paid in full', () => {
    // KH-2791 exactly: 'not_due' because the repeat commitment owed ₱0 at
    // checkout, then ₱1,140 settled with a bank proof and awaiting review.
    const badge = orderBadge({
      status: 'payment_confirmed', paymentStatus: 'not_due', settlementStatus: 'proof_review',
    });

    expect(badge.label).toBe('Proof Submitted');
    expect(badge.label).not.toMatch(/no payment due/i);
  });

  it('confirms the payment once an admin has verified the settlement', () => {
    expect(orderBadge({
      status: 'payment_confirmed', paymentStatus: 'not_due', settlementStatus: 'paid',
    }).label).toBe('Payment Confirmed');
  });

  it('does not claim a confirmed payment while the settlement is still unverified', () => {
    // The overclaim direction, and the larger number: 20 live orders whose
    // ₱150 downpayment is verified and whose balance nobody has checked.
    expect(orderBadge({
      status: 'payment_confirmed', paymentStatus: 'confirmed', settlementStatus: 'proof_review',
    }).label).toBe('Proof Submitted');
  });

  it('goes back to owing when the settlement was cancelled', () => {
    expect(orderBadge({
      status: 'payment_confirmed', paymentStatus: 'not_due', settlementStatus: 'cancelled',
    }).label).toBe('No Payment Due');
  });

  it('still reports the parcel once it is moving', () => {
    // Past the payment phase the parcel is the news, settlement or not.
    expect(orderBadge({
      status: 'shipped', paymentStatus: 'not_due', settlementStatus: 'proof_review',
    }).label).toBe('Shipped');
  });
});
