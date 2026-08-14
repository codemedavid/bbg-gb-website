// Reconciling several transfers against one order total.
//
// §13's arithmetic: an order of ₱4,500 paid as ₱2,000 + ₱1,500 + ₱1,000 is
// settled; the same three proofs with only two amounts recorded is not evidence
// of anything yet. The admin needs to see which of those they are looking at
// without doing the sum in their head against a bank statement.
import { describe, it, expect } from 'vitest';
import { reconcileProofs } from '@/lib/proof-reconciliation';

const proof = (amountPhp: string | null) => ({ amountPhp });

describe('reconcileProofs', () => {
  it('adds up what the admin has recorded', () => {
    const r = reconcileProofs([proof('2000.00'), proof('1500.00'), proof('1000.00')], '4500.00');

    expect(r.recorded).toBe(4500);
  });

  it('calls an order settled when the recorded amounts meet the total', () => {
    const r = reconcileProofs([proof('2000.00'), proof('2500.00')], '4500.00');

    expect(r.state).toBe('settled');
    expect(r.outstanding).toBe(0);
  });

  it('reports the shortfall when they do not', () => {
    // The number the admin chases. "Not settled" alone leaves them subtracting.
    const r = reconcileProofs([proof('2000.00'), proof('1500.00')], '4500.00');

    expect(r.state).toBe('short');
    expect(r.outstanding).toBe(1000);
  });

  it('flags an overpayment rather than treating it as settled', () => {
    // A customer who transferred twice by mistake is owed a refund, and that is
    // a different conversation from a paid order.
    const r = reconcileProofs([proof('3000.00'), proof('2000.00')], '4500.00');

    expect(r.state).toBe('over');
    expect(r.outstanding).toBe(-500);
  });

  it('says nothing has been recorded yet when no proof carries an amount', () => {
    // Three screenshots and no amounts is the state every order starts in. It
    // must not read as "₱0 paid, ₱4,500 short" — nobody has looked yet.
    const r = reconcileProofs([proof(null), proof(null)], '4500.00');

    expect(r.state).toBe('unrecorded');
    expect(r.recorded).toBe(0);
  });

  it('treats a partly-recorded set as short, not as unrecorded', () => {
    // The admin got through two of three. That IS a shortfall so far, and
    // showing it is what tells them they have one left to do.
    const r = reconcileProofs([proof('2000.00'), proof(null)], '4500.00');

    expect(r.state).toBe('short');
    expect(r.recorded).toBe(2000);
  });

  it('counts how many proofs still have no amount against them', () => {
    const r = reconcileProofs([proof('2000.00'), proof(null), proof(null)], '4500.00');

    expect(r.unrecordedCount).toBe(2);
  });

  it('handles an order with no proofs at all', () => {
    const r = reconcileProofs([], '4500.00');

    expect(r.state).toBe('unrecorded');
    expect(r.recorded).toBe(0);
    expect(r.unrecordedCount).toBe(0);
  });

  it('tolerates centavo rounding rather than reporting a one-centavo shortfall', () => {
    // Three ways of splitting ₱4,500 rarely divide evenly, and an order that is
    // ₱0.001 short is settled by any reading a human would give it.
    const r = reconcileProofs([proof('1500.00'), proof('1500.00'), proof('1500.001')], '4500.00');

    expect(r.state).toBe('settled');
  });

  it('ignores an unparseable amount instead of poisoning the sum with NaN', () => {
    // A stored value should never be junk, but one NaN would turn the whole
    // reconciliation into "NaN of ₱4,500" on screen.
    const r = reconcileProofs([proof('2000.00'), proof('not-a-number')], '4500.00');

    expect(r.recorded).toBe(2000);
  });
});
