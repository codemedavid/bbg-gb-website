// Payment is not fulfilment, and this module is where the two stop being the
// same field.
//
// `orders.status` runs proof_review -> payment_confirmed -> batch_filling ->
// shipped -> delivered. Two of those are statements about money and three are
// statements about a parcel, and because there is only one column, a state the
// flow has no word for has to borrow one that means something else. That is
// exactly what happened: a repeat kahati commitment owes nothing at checkout,
// the flow had no "nothing due" state, so checkout wrote 'payment_confirmed'
// and My Orders told 72 customers their payment was confirmed when ~₱158k of
// goods had not been paid for and 38 of those orders carried no proof at all.
//
// The fix is not a different label on the same field. It is a second field that
// only ever describes money, with a state for every thing money can actually be
// doing — including owing nothing yet.
import { describe, it, expect } from 'vitest';
import {
  PAYMENT_STATUSES, PAYMENT_STATUS_LABEL,
  checkoutPaymentStatus, derivePaymentStatus, isPaymentVerified,
  isAdminOnlyPaymentStatus, overallPaymentStatus, type PaymentStatus,
} from '@/lib/payment-status';

describe('the payment vocabulary', () => {
  it('has a word for every thing money can be doing, including owing nothing', () => {
    expect([...PAYMENT_STATUSES].sort()).toEqual(
      ['confirmed', 'not_due', 'pending', 'proof_submitted', 'rejected'],
    );
  });

  it('never labels an unpaid order as a confirmed payment', () => {
    // The whole bug in one assertion. 'not_due' is the state a confirm-only
    // kahati order is really in; if it renders as "Payment Confirmed" the
    // column has bought us nothing.
    expect(PAYMENT_STATUS_LABEL.not_due).not.toMatch(/confirm/i);
    expect(PAYMENT_STATUS_LABEL.confirmed).toBe('Payment Confirmed');
  });

  it('treats only a verified payment as verified', () => {
    const verified = PAYMENT_STATUSES.filter(isPaymentVerified);
    expect(verified).toEqual(['confirmed']);
  });

  it('reserves confirming and rejecting for an admin', () => {
    expect(PAYMENT_STATUSES.filter(isAdminOnlyPaymentStatus).sort())
      .toEqual(['confirmed', 'rejected']);
  });
});

describe('what a checkout is allowed to write', () => {
  it('records that nothing was due when nothing was due', () => {
    expect(checkoutPaymentStatus({ nothingDue: true, proofCount: 0 })).toBe('not_due');
  });

  it('records a proof as submitted, not as verified', () => {
    // Nobody has looked at it yet. This is the distinction the client asked for:
    // uploading is not confirming.
    expect(checkoutPaymentStatus({ nothingDue: false, proofCount: 1 })).toBe('proof_submitted');
  });

  it('records money owed with no proof as pending', () => {
    expect(checkoutPaymentStatus({ nothingDue: false, proofCount: 0 })).toBe('pending');
  });

  it('can never produce a status only an admin may set', () => {
    // Exhaustive rather than illustrative: no combination of inputs a client
    // controls may reach 'confirmed'. A frontend that cannot express the state
    // cannot be manipulated into it.
    for (const nothingDue of [true, false]) {
      for (const proofCount of [0, 1, 2, 5]) {
        const status = checkoutPaymentStatus({ nothingDue, proofCount });
        expect(isAdminOnlyPaymentStatus(status)).toBe(false);
      }
    }
  });
});

describe('reading a row written before the column existed', () => {
  // The backfill rule, stated as behaviour so the migration and the runtime
  // fallback cannot drift. `proofs` is what the order actually carries.
  const legacy = (status: string, proofs: number): PaymentStatus =>
    derivePaymentStatus({ status, paymentStatus: null, proofCount: proofs });

  it('reads a confirmed order that carries proof as genuinely confirmed', () => {
    expect(legacy('payment_confirmed', 1)).toBe('confirmed');
    expect(legacy('shipped', 2)).toBe('confirmed');
    expect(legacy('delivered', 1)).toBe('confirmed');
  });

  it('reads a confirmed order with NO proof as nothing-due, not confirmed', () => {
    // These are the 24 live rows. An admin verified nothing, because there was
    // nothing to verify — so the row must not claim they did.
    expect(legacy('payment_confirmed', 0)).toBe('not_due');
    expect(legacy('batch_filling', 0)).toBe('not_due');
  });

  it('distinguishes an awaiting-review order by whether a proof arrived', () => {
    expect(legacy('proof_review', 1)).toBe('proof_submitted');
    expect(legacy('proof_review', 0)).toBe('pending');
  });

  it('does not let a cancellation erase money we are holding', () => {
    // Cancellation is a FULFILMENT fact. Letting it overwrite the payment fact
    // is the same conflation this module exists to end — and it has a cost:
    // 19 cancelled orders in production carry a proof and 10 hold deposits
    // (₱1,500 between them). Reading those as "nothing due" forgets a refund we
    // owe. A cancelled order that was paid for is still paid for.
    expect(legacy('cancelled', 3)).toBe('confirmed');
  });

  it('owes nothing on a cancelled order that was never paid', () => {
    expect(legacy('cancelled', 0)).toBe('not_due');
  });

  it('assumes money is owed on a status it does not recognise', () => {
    // The safe direction: an unknown state must not silently read as paid.
    expect(legacy('some_future_state', 0)).toBe('pending');
  });

  it('prefers the stored column over any derivation once it exists', () => {
    expect(derivePaymentStatus({
      status: 'payment_confirmed', paymentStatus: 'rejected', proofCount: 1,
    })).toBe('rejected');
  });
});

describe('an order the customer has since paid at the hatian final checkout', () => {
  // The reported defect, in the client's words: "nawala daw payment".
  //
  // A hatian order collects money TWICE — the downpayment at checkout, and the
  // balance at the final checkout, which is a settlement row and not an
  // order-level proof. `orders.payment_status` only ever heard about the first
  // one, so KH-2791 — a repeat commitment that owed ₱0 at checkout and whose
  // customer then paid the whole ₱1,140 balance and uploaded the bank proof —
  // still read 'not_due'. The customer saw "No Payment Due" over money they had
  // just sent.
  //
  // Two obligations, one answer: report the LESS resolved of them. Anything
  // else either forgets a payment (not_due over a paid settlement) or claims
  // one nobody has checked (confirmed over a settlement still in review).
  const settled = (paymentStatus: string | null, settlementStatus: string | null): PaymentStatus =>
    overallPaymentStatus({
      status: 'payment_confirmed', paymentStatus, proofCount: 0, settlementStatus,
    });

  it('stops saying nothing is due once the balance has been paid', () => {
    // KH-2791 and 4 more live orders (₱4,295 between them).
    expect(settled('not_due', 'proof_review')).toBe('proof_submitted');
  });

  it('confirms the payment once an admin has verified the settlement', () => {
    // 8 more live orders, each showing "No Payment Due" over a VERIFIED payment.
    expect(settled('not_due', 'paid')).toBe('confirmed');
  });

  it('does not claim a confirmed payment while the settlement is unverified', () => {
    // 20 live orders. The downpayment was verified and the balance — the far
    // larger sum, ₱136,487.75 across them — has not been. Reporting the better
    // of the two tells a customer their money was checked when nobody has
    // looked, which is the exact lie this module exists to end.
    expect(settled('confirmed', 'proof_review')).toBe('proof_submitted');
  });

  it('keeps reporting an unpaid downpayment after the balance clears', () => {
    // The settlement covers the BALANCE. It says nothing about a downpayment
    // still owed or already rejected, so it must not paper over one.
    expect(settled('pending', 'paid')).toBe('pending');
    expect(settled('rejected', 'paid')).toBe('rejected');
  });

  it('ignores a cancelled settlement, which collected nothing', () => {
    expect(settled('not_due', 'cancelled')).toBe('not_due');
    expect(settled('confirmed', 'cancelled')).toBe('confirmed');
  });

  it('leaves an order carrying no settlement exactly as it was', () => {
    for (const stored of ['pending', 'proof_submitted', 'confirmed', 'rejected', 'not_due']) {
      expect(settled(stored, null)).toBe(stored);
      expect(settled(stored, undefined as unknown as null)).toBe(stored);
    }
  });

  it('derives a legacy row own state first, then folds the settlement in', () => {
    // A row written before payment_status existed still has to answer, and the
    // settlement is the newer of the two facts either way.
    expect(overallPaymentStatus({
      status: 'payment_confirmed', paymentStatus: null, proofCount: 1,
      settlementStatus: 'proof_review',
    })).toBe('proof_submitted');
  });

  it('never reads a settlement status it does not recognise as a payment', () => {
    expect(settled('not_due', 'some_future_state')).toBe('not_due');
  });
});
