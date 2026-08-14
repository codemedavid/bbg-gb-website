// The hatian final checkout: which orders are ready to settle, what one
// settlement costs, and how each payment reads back to customer and admin.
//
// The rule these guard: a customer may join any number of hatians paying only
// downpayments, and pays exactly ONE packing fee when they settle the completed
// ones. Charging per commitment (the old behaviour) is the bug.
import { describe, it, expect } from 'vitest';
import {
  isReadyToSettle, settlementTotals, orderBalance,
  downpaymentState, finalPaymentState, packingFeeState,
  type SettleableOrder,
} from './settlement';

const order = (o: Partial<SettleableOrder> = {}): SettleableOrder => ({
  id: 'o1', status: 'payment_confirmed', totalPhp: 6300, downpaymentPhp: 150,
  packingFeePhp: 0, hatianPackingFeePhp: 150, cycleKey: null, settlementId: null, ...o,
});

describe('isReadyToSettle', () => {
  it('accepts an order whose hatian has closed', () => {
    expect(isReadyToSettle({ status: 'payment_confirmed', settlementId: null, groupBuyStatuses: ['closed'] })).toBe(true);
  });

  it('accepts a shipped or completed hatian too', () => {
    expect(isReadyToSettle({ status: 'batch_filling', settlementId: null, groupBuyStatuses: ['shipped'] })).toBe(true);
    expect(isReadyToSettle({ status: 'batch_filling', settlementId: null, groupBuyStatuses: ['completed'] })).toBe(true);
  });

  it('rejects an order whose hatian is still open — nothing to settle yet', () => {
    expect(isReadyToSettle({ status: 'payment_confirmed', settlementId: null, groupBuyStatuses: ['open'] })).toBe(false);
  });

  it('rejects an overflow order while any of its counters is still open', () => {
    // A commitment that rolled into a sibling ships as one parcel; settling it
    // before the sibling closes would bill a fee for a parcel that is not ready.
    expect(isReadyToSettle({ status: 'payment_confirmed', settlementId: null, groupBuyStatuses: ['closed', 'open'] })).toBe(false);
  });

  it('rejects an order that is already settled', () => {
    expect(isReadyToSettle({ status: 'payment_confirmed', settlementId: 's1', groupBuyStatuses: ['closed'] })).toBe(false);
  });

  it('rejects a cancelled order', () => {
    expect(isReadyToSettle({ status: 'cancelled', settlementId: null, groupBuyStatuses: ['closed'] })).toBe(false);
  });

  it('rejects an order with no hatian lines at all', () => {
    expect(isReadyToSettle({ status: 'payment_confirmed', settlementId: null, groupBuyStatuses: [] })).toBe(false);
  });

  // Orders placed before the fee was deferred carry their packing fee on the
  // order row. They predate this flow entirely: their balances were collected
  // off-platform under the old arrangement, and nothing in the database records
  // whether that happened. Quoting them here would re-bill a balance the
  // customer may well have already paid in person.
  it('rejects a legacy order that was charged its packing fee at commit time', () => {
    expect(isReadyToSettle({
      status: 'payment_confirmed', settlementId: null, groupBuyStatuses: ['closed'], packingFeePhp: 150,
    })).toBe(false);
  });

  it('accepts an order placed under the deferred rule', () => {
    expect(isReadyToSettle({
      status: 'payment_confirmed', settlementId: null, groupBuyStatuses: ['closed'], packingFeePhp: 0,
    })).toBe(true);
  });
});

describe('orderBalance', () => {
  it('is only the remaining amount to collect, not a reduced order total', () => {
    expect(orderBalance(order({ totalPhp: 6300, downpaymentPhp: 150 }))).toBe(6150);
  });

  it('never goes negative when the downpayment covered the whole order', () => {
    expect(orderBalance(order({ totalPhp: 100, downpaymentPhp: 150 }))).toBe(0);
  });
});

describe('settlementTotals', () => {
  it('charges exactly one packing fee for several settled hatians', () => {
    const t = settlementTotals([
      order({ id: 'a', totalPhp: 6300, downpaymentPhp: 150, hatianPackingFeePhp: 150 }),
      order({ id: 'b', totalPhp: 2700, downpaymentPhp: 150, hatianPackingFeePhp: 150 }),
      order({ id: 'c', totalPhp: 900, downpaymentPhp: 150, hatianPackingFeePhp: 150 }),
    ]);
    expect(t.packingFeePhp).toBe(150);
    expect(t.balancePhp).toBe(6150 + 2550 + 750);
    expect(t.totalPhp).toBe(6150 + 2550 + 750 + 150);
  });

  it('charges the largest hatian fee when the settled hatians differ', () => {
    const t = settlementTotals([
      order({ id: 'a', hatianPackingFeePhp: 150 }),
      order({ id: 'b', hatianPackingFeePhp: 220 }),
    ]);
    expect(t.packingFeePhp).toBe(220);
  });

  it('charges no second fee for a legacy order that already paid one at commit', () => {
    // Orders placed before the deferral carry their fee on the order row. They
    // must not be billed again at settlement.
    const t = settlementTotals([order({ packingFeePhp: 150, hatianPackingFeePhp: 150 })]);
    expect(t.packingFeePhp).toBe(0);
  });

  it('bills one fee when a legacy order is settled alongside a deferred one', () => {
    const t = settlementTotals([
      order({ id: 'legacy', packingFeePhp: 150, hatianPackingFeePhp: 150 }),
      order({ id: 'new', packingFeePhp: 0, hatianPackingFeePhp: 180 }),
    ]);
    expect(t.packingFeePhp).toBe(180);
  });

  it('settles to zero for an empty set', () => {
    expect(settlementTotals([])).toEqual({ balancePhp: 0, packingFeePhp: 0, totalPhp: 0 });
  });
});

describe('payment states shown to the admin', () => {
  it('reports the downpayment as under review until the proof is confirmed', () => {
    expect(downpaymentState(order({ status: 'proof_review' }))).toBe('under_review');
    expect(downpaymentState(order({ status: 'payment_confirmed' }))).toBe('paid');
    expect(downpaymentState(order({ status: 'delivered' }))).toBe('paid');
    expect(downpaymentState(order({ status: 'cancelled' }))).toBe('cancelled');
  });

  it('reports the final payment as unpaid until a settlement covers the order', () => {
    expect(finalPaymentState(order(), null)).toBe('unpaid');
    expect(finalPaymentState(order({ settlementId: 's1' }), 'proof_review')).toBe('under_review');
    expect(finalPaymentState(order({ settlementId: 's1' }), 'paid')).toBe('paid');
  });

  it('reports the final payment as unpaid again when its settlement was cancelled', () => {
    expect(finalPaymentState(order({ settlementId: 's1' }), 'cancelled')).toBe('unpaid');
  });

  it('reports the packing fee as unpaid until the settlement is paid', () => {
    expect(packingFeeState(order(), null)).toBe('unpaid');
    expect(packingFeeState(order({ settlementId: 's1' }), 'proof_review')).toBe('under_review');
    expect(packingFeeState(order({ settlementId: 's1' }), 'paid')).toBe('paid');
  });

  it('reports a legacy order’s packing fee as already paid at commit', () => {
    expect(packingFeeState(order({ packingFeePhp: 150 }), null)).toBe('paid');
  });
});

describe('orders placed under the per-cycle packing fee', () => {
  // Three generations of order meet in this flow and each needs different
  // treatment. The middle one is why the legacy guard cannot simply be
  // inverted, and the last is why it cannot be left alone.
  //
  //   1. legacy      — fee charged at commit, no cycle. Never settled here.
  //   2. deferred    — no fee, no cycle. Settled, and the fee is collected now.
  //   3. per-cycle   — cycle stamped; the fee was paid at checkout. Settled,
  //                    and NO fee is collected again.

  it('settles an order that paid its packing fee at checkout', () => {
    // The regression this test exists for: the legacy guard excluded every
    // order carrying a fee, which under the per-cycle rule is every new order —
    // silently making all of them unsettleable.
    expect(isReadyToSettle({
      status: 'payment_confirmed', settlementId: null, groupBuyStatuses: ['closed'],
      packingFeePhp: 150, cycleKey: '2026-08-05T12:00:00.000Z',
    })).toBe(true);
  });

  it('settles an order whose cycle fee was waived', () => {
    expect(isReadyToSettle({
      status: 'payment_confirmed', settlementId: null, groupBuyStatuses: ['closed'],
      packingFeePhp: 0, cycleKey: '2026-08-05T12:00:00.000Z',
    })).toBe(true);
  });

  it('still keeps a legacy order out of the flow', () => {
    // A fee with no cycle is an order placed before cycles existed, whose
    // balance was settled off-platform. Quoting it here would ask the customer
    // to pay again.
    expect(isReadyToSettle({
      status: 'payment_confirmed', settlementId: null, groupBuyStatuses: ['closed'],
      packingFeePhp: 150, cycleKey: null,
    })).toBe(false);
  });

  it('charges no second packing fee at settlement', () => {
    // The fee was paid at checkout with the cycle it belongs to.
    const t = settlementTotals([
      order({ packingFeePhp: 150, hatianPackingFeePhp: 150, cycleKey: '2026-08-05T12:00:00.000Z' }),
    ]);

    expect(t.packingFeePhp).toBe(0);
    expect(t.totalPhp).toBe(t.balancePhp);
  });

  it('charges no fee for a waived cycle order either', () => {
    const t = settlementTotals([
      order({ packingFeePhp: 0, hatianPackingFeePhp: 150, cycleKey: '2026-08-05T12:00:00.000Z' }),
    ]);

    expect(t.packingFeePhp).toBe(0);
  });

  it('still collects the deferred fee for an order placed before cycles existed', () => {
    // Generation 2 keeps working exactly as it did: no fee on the order, no
    // cycle, so the settlement collects the one fee it always did.
    const t = settlementTotals([order({ packingFeePhp: 0, hatianPackingFeePhp: 150, cycleKey: null })]);

    expect(t.packingFeePhp).toBe(150);
  });

  it('reads the packing fee as paid on a per-cycle order', () => {
    expect(packingFeeState({ settlementId: null, packingFeePhp: 0, cycleKey: '2026-08-05T12:00:00.000Z' }, null))
      .toBe('paid');
  });
});
