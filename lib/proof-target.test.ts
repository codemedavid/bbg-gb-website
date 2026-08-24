// What a payment proof is checked against while a hatian kit is still filling.
import { describe, it, expect } from 'vitest';
import { proofTargetPhp, reconcileOrderProofs, reconcileProofs } from './proof-reconciliation';

describe('proofTargetPhp', () => {
  it('is the order total for an on-hand order', () => {
    expect(proofTargetPhp({ buyType: 'solo', totalPhp: '1950' })).toBe(1950);
  });

  it('is the downpayment for an unsettled kahati commitment', () => {
    // Arrange — a ₱1,950 commitment that paid a ₱500 deposit.
    const order = { buyType: 'kahati', totalPhp: '1950', downpaymentPhp: '500', settlementId: null };
    // Act / Assert — the deposit is what the proof should evidence.
    expect(proofTargetPhp(order)).toBe(500);
  });

  it('goes back to the total once the balance has been settled', () => {
    expect(proofTargetPhp({
      buyType: 'kahati', totalPhp: '1950', downpaymentPhp: '500', settlementId: 's1',
    })).toBe(1950);
  });

  it('is the total for a commitment that owed nothing at checkout', () => {
    // A repeat commitment in a cycle whose fee was already paid collects ₱0, so
    // there is no deposit for a proof to match.
    expect(proofTargetPhp({
      buyType: 'kahati', totalPhp: '1950', downpaymentPhp: '0', settlementId: null,
    })).toBe(1950);
  });

  it('never exceeds the order total', () => {
    expect(proofTargetPhp({
      buyType: 'kahati', totalPhp: '250', downpaymentPhp: '500', settlementId: null,
    })).toBe(250);
  });

  it('reads an unusable total as zero rather than NaN', () => {
    expect(proofTargetPhp({ buyType: 'solo', totalPhp: 'not-a-number' })).toBe(0);
  });
});

describe('reconciling a kahati deposit', () => {
  it('reads a correctly-paid downpayment as settled, not short', () => {
    // Arrange
    const order = { buyType: 'kahati', totalPhp: '1950', downpaymentPhp: '500', settlementId: null };
    const proofs = [{ amountPhp: '500' }];
    // Act
    const r = reconcileProofs(proofs, proofTargetPhp(order));
    // Assert
    expect(r.state).toBe('settled');
    expect(r.outstanding).toBe(0);
  });

  it('still reports a genuine shortfall against the downpayment', () => {
    const order = { buyType: 'kahati', totalPhp: '1950', downpaymentPhp: '500', settlementId: null };
    const r = reconcileProofs([{ amountPhp: '300' }], proofTargetPhp(order));
    expect(r.state).toBe('short');
    expect(r.outstanding).toBe(200);
  });
});

describe('reconciling proofs an order shares with its split siblings', () => {
  it('does not call a shared transfer an overpayment of the deposit', () => {
    // Arrange — a mixed cart: a ₱1,950 hatian order (₱500 deposit) and a ₱1,200
    // on-hand order, paid in ONE ₱3,150 transfer whose proof is written onto
    // both orders. The admin records what the bank statement says.
    const order = { buyType: 'kahati', totalPhp: '1950', downpaymentPhp: '500', settlementId: null };
    // Act
    const r = reconcileOrderProofs([{ amountPhp: '3150' }], order);
    // Assert — the deposit is covered; nothing here is a refund.
    expect(r.state).toBe('settled');
    expect(r.outstanding).toBe(0);
    // The figure the admin typed is still shown back to them.
    expect(r.recorded).toBe(3150);
  });

  it('still calls a genuine overpayment of a FULL total an overpayment', () => {
    const order = { buyType: 'solo', totalPhp: '1000' };
    expect(reconcileOrderProofs([{ amountPhp: '1500' }], order).state).toBe('over');
  });

  it('still reports a deposit that was underpaid', () => {
    const order = { buyType: 'kahati', totalPhp: '1950', downpaymentPhp: '500', settlementId: null };
    const r = reconcileOrderProofs([{ amountPhp: '300' }], order);
    expect(r.state).toBe('short');
    expect(r.outstanding).toBe(200);
  });

  it('reports nothing recorded as unrecorded, not as a settled deposit', () => {
    const order = { buyType: 'kahati', totalPhp: '1950', downpaymentPhp: '500', settlementId: null };
    expect(reconcileOrderProofs([{ amountPhp: null }], order).state).toBe('unrecorded');
  });
});
