import { describe, it, expect } from 'vitest';
import { hatianBatchSummary, type BatchCommitment } from './hatian-batch-summary';

// A participant row reduced to the fields the summary actually reads. The
// balance fields are here only so the tests below can prove they are IGNORED —
// see the double-counting note in the module.
const commitment = (o: Partial<BatchCommitment> = {}): BatchCommitment => ({
  orderId: 'o1', orderStatus: 'payment_confirmed', vials: 3,
  orderBalancePhp: 2550, spansOtherHatians: false,
  downpayment: 'paid', finalPayment: 'unpaid', packingFee: 'unpaid',
  ...o,
});

// One kit of 10 vials at ₱450/vial — the shape of every hatian.
const hatian = { totalSlots: 10, perVialPhp: 450 };

describe('hatianBatchSummary', () => {
  it('counts every listed participant', () => {
    const s = hatianBatchSummary([commitment({ orderId: 'a' }), commitment({ orderId: 'b' })], hatian);
    expect(s.totalParticipants).toBe(2);
  });

  it('sums the vials reserved across participants', () => {
    const s = hatianBatchSummary(
      [commitment({ orderId: 'a', vials: 3 }), commitment({ orderId: 'b', vials: 2 })],
      hatian,
    );
    expect(s.totalVialsReserved).toBe(5);
  });

  it('reports the vials still open in the kit', () => {
    const s = hatianBatchSummary([commitment({ vials: 4 })], hatian);
    expect(s.remainingVials).toBe(6);
  });

  // The cap is a promise the database also enforces, but a summary that renders
  // "-2 remaining" from a legacy over-filled row is worse than one that says 0.
  it('never reports negative remaining vials', () => {
    const s = hatianBatchSummary([commitment({ vials: 14 })], hatian);
    expect(s.remainingVials).toBe(0);
  });

  // Gross income is deliberately vials x this counter's per-vial price, NOT the
  // sum of order balances: an overflow commitment carries the whole ORDER's
  // balance under both counters, so summing that column bills the same money
  // twice. Vials are what this batch actually sold.
  it('values the batch at this counter s own per-vial price', () => {
    const s = hatianBatchSummary(
      [commitment({ orderId: 'a', vials: 3 }), commitment({ orderId: 'b', vials: 2 })],
      hatian,
    );
    expect(s.grossIncomePhp).toBe(2250);
  });

  it('does not let a shared order balance double-count into gross income', () => {
    const s = hatianBatchSummary(
      [commitment({ orderId: 'a', vials: 2, spansOtherHatians: true, orderBalancePhp: 9999 })],
      hatian,
    );
    expect(s.grossIncomePhp).toBe(900);
  });

  describe('cancelled orders', () => {
    const live = commitment({ orderId: 'live', vials: 3 });
    const cancelled = commitment({
      orderId: 'dead', vials: 4, orderStatus: 'cancelled',
      downpayment: 'cancelled', finalPayment: 'cancelled', packingFee: 'cancelled',
    });

    // The client's rule, and the reason this module exists: a cancelled order is
    // money that will not arrive and a vial that must not be ordered from the
    // supplier. Counting either one overstates the batch.
    it('keeps cancelled orders out of gross income', () => {
      expect(hatianBatchSummary([live, cancelled], hatian).grossIncomePhp).toBe(1350);
    });

    it('keeps cancelled orders out of the vials reserved with the supplier', () => {
      expect(hatianBatchSummary([live, cancelled], hatian).totalVialsReserved).toBe(3);
    });

    it('frees a cancelled order s vials back into the remaining count', () => {
      expect(hatianBatchSummary([live, cancelled], hatian).remainingVials).toBe(7);
    });

    it('reports cancelled orders on their own line', () => {
      expect(hatianBatchSummary([live, cancelled], hatian).cancelledOrders).toBe(1);
    });

    // Still listed in the table, so still counted as a participant — the summary
    // explains the table rather than describing a different set of rows.
    it('still counts a cancelled order as a listed participant', () => {
      expect(hatianBatchSummary([live, cancelled], hatian).totalParticipants).toBe(2);
    });
  });

  describe('payment counts', () => {
    const settled = commitment({
      orderId: 'settled', downpayment: 'paid', finalPayment: 'paid', packingFee: 'paid',
    });
    const owing = commitment({
      orderId: 'owing', downpayment: 'paid', finalPayment: 'unpaid', packingFee: 'unpaid',
    });
    const reviewing = commitment({
      orderId: 'reviewing', downpayment: 'under_review', finalPayment: 'unpaid', packingFee: 'unpaid',
    });

    it('counts a participant who owes nothing as confirmed', () => {
      expect(hatianBatchSummary([settled], hatian).confirmedPayments).toBe(1);
    });

    it('counts a participant with anything still owed as pending', () => {
      expect(hatianBatchSummary([owing], hatian).pendingPayments).toBe(1);
    });

    it('counts a proof still under review as pending, not confirmed', () => {
      const s = hatianBatchSummary([reviewing], hatian);
      expect(s.pendingPayments).toBe(1);
      expect(s.confirmedPayments).toBe(0);
    });

    // A cancelled order owes nothing and has paid nothing. Letting it fall into
    // either bucket makes the three lines stop adding up to the participant
    // count, which is how an admin checks the summary against the table.
    it('files a cancelled order under neither confirmed nor pending', () => {
      const s = hatianBatchSummary([
        settled, owing,
        commitment({
          orderId: 'dead', orderStatus: 'cancelled',
          downpayment: 'cancelled', finalPayment: 'cancelled', packingFee: 'cancelled',
        }),
      ], hatian);
      expect(s.confirmedPayments).toBe(1);
      expect(s.pendingPayments).toBe(1);
      expect(s.cancelledOrders).toBe(1);
      expect(s.confirmedPayments + s.pendingPayments + s.cancelledOrders).toBe(s.totalParticipants);
    });
  });

  // An admin opens this panel on a counter nobody has joined yet to check they
  // opened the right one. Every figure has to be a number, not a NaN or a crash.
  it('reports a zeroed summary for a hatian nobody has joined', () => {
    expect(hatianBatchSummary([], hatian)).toEqual({
      totalParticipants: 0, totalVialsReserved: 0, remainingVials: 10,
      grossIncomePhp: 0, confirmedPayments: 0, pendingPayments: 0, cancelledOrders: 0,
    });
  });

  // Money is rounded once, at the end. Per-row rounding of a fractional per-vial
  // price drifts by centavos across ten participants.
  it('rounds gross income to centavos', () => {
    const s = hatianBatchSummary(
      [commitment({ orderId: 'a', vials: 3 }), commitment({ orderId: 'b', vials: 3 })],
      { totalSlots: 10, perVialPhp: 333.333 },
    );
    expect(s.grossIncomePhp).toBe(2000);
  });
});
