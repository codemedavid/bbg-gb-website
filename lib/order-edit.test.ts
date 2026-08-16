import { describe, it, expect } from 'vitest';
import { customerEditability, isCustomerEditable, EDIT_BLOCKED_MESSAGE } from './order-edit';

const order = (o: Partial<Parameters<typeof customerEditability>[0]> = {}) => ({
  status: 'proof_review', buyType: 'kahati', settlementId: null, ...o,
});

describe('customerEditability', () => {
  it('lets a customer fix an order whose payment is still under review', () => {
    expect(customerEditability(order({ status: 'proof_review', buyType: 'solo' }))).toBe('editable');
  });

  // On-hand is paid in full at checkout, so a confirmed payment closes it.
  it('closes an on-hand order once its payment is confirmed', () => {
    expect(customerEditability(order({ status: 'payment_confirmed', buyType: 'solo' }))).toBe('paid_in_full');
  });

  it('closes an MOQ-shelf order once its payment is confirmed', () => {
    expect(customerEditability(order({ status: 'payment_confirmed', buyType: 'moq' }))).toBe('paid_in_full');
  });

  // The deferred boards collect only the packing fee up front — the balance is
  // genuinely still outstanding, which is exactly the case the client raised.
  it('keeps a kahati order open after its downpayment is confirmed', () => {
    expect(customerEditability(order({ status: 'payment_confirmed', buyType: 'kahati' }))).toBe('editable');
  });

  it('keeps a group buy order open after its downpayment is confirmed', () => {
    expect(customerEditability(order({ status: 'payment_confirmed', buyType: 'group_buy' }))).toBe('editable');
  });

  it.each(['batch_filling', 'shipped', 'delivered', 'cancelled'])(
    'closes an order once it is %s, whichever board it came from',
    (status) => {
      expect(customerEditability(order({ status, buyType: 'kahati' }))).toBe('fulfilment_started');
    },
  );

  // Fulfilment beats everything: a batch being counted must not shift under it.
  it('reports fulfilment rather than settlement when both would close it', () => {
    expect(customerEditability(order({ status: 'batch_filling', settlementId: 's1' }), 'paid'))
      .toBe('fulfilment_started');
  });

  it('closes an order a live settlement has claimed', () => {
    expect(customerEditability(order({ settlementId: 's1' }), 'proof_review')).toBe('in_settlement');
    expect(customerEditability(order({ settlementId: 's1' }), 'paid')).toBe('in_settlement');
  });

  // A cancelled settlement releases its orders, so it must not keep locking one.
  it('reopens an order whose settlement was cancelled', () => {
    expect(customerEditability(order({ settlementId: 's1' }), 'cancelled')).toBe('editable');
  });

  it('ignores a settlement id with no settlement behind it', () => {
    expect(customerEditability(order({ settlementId: 's1' }), null)).toBe('editable');
  });

  it('has a message for every reason it refuses', () => {
    const reasons = ['fulfilment_started', 'paid_in_full', 'in_settlement'] as const;
    for (const reason of reasons) {
      expect(EDIT_BLOCKED_MESSAGE[reason]).toMatch(/\w/);
    }
  });
});

describe('isCustomerEditable', () => {
  it('is true only for the editable reason', () => {
    expect(isCustomerEditable(order())).toBe(true);
    expect(isCustomerEditable(order({ status: 'shipped' }))).toBe(false);
  });
});
