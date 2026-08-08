// One packing fee per trading cycle — the rules, with no database in sight.
//
// The fee buys a PARCEL, and a cycle produces one parcel: everything a customer
// orders from Group Buy and Hatian between one opening and the next is packed
// and shipped together. So the fee is charged once per cycle, across BOTH
// boards, however many hatians and campaigns they joined.
//
// This replaces two narrower rules that each answered part of the question —
// one waiver per campaign series, one deposit per open hatian — and could
// therefore both fire in a single week and bill a customer twice.
import { describe, it, expect } from 'vitest';
import { hasPaidPackingFeeThisCycle, packingFeeDueThisCycle } from '@/lib/packing-cycle';

const paid = (over: Partial<{ orderStatus: string; packingFeePhp: number }> = {}) => ({
  orderStatus: 'proof_review' as never, packingFeePhp: 150, ...over,
});

describe('hasPaidPackingFeeThisCycle', () => {
  it('is false when the customer has ordered nothing this cycle', () => {
    expect(hasPaidPackingFeeThisCycle([])).toBe(false);
  });

  it('is true once an order in this cycle carried a fee', () => {
    expect(hasPaidPackingFeeThisCycle([paid()])).toBe(true);
  });

  it('ignores an order that was itself waived', () => {
    // An order charged ₱0 is not a source of a further waiver: letting it be one
    // would chain the fee away forever — the first order pays, the second rides
    // free on it, the third rides on the second, and nobody pays again.
    expect(hasPaidPackingFeeThisCycle([paid({ packingFeePhp: 0 })])).toBe(false);
  });

  it('ignores a cancelled order', () => {
    // A cancelled order was refunded, so nothing was paid to pack anything.
    expect(hasPaidPackingFeeThisCycle([paid({ orderStatus: 'cancelled' })])).toBe(false);
  });

  it('still counts an order that has already shipped', () => {
    // Unlike the per-parcel rule this replaces, a cycle is a fixed period: the
    // customer paid to have this cycle's goods packed, and an early shipment
    // does not entitle anyone to charge them for it a second time.
    expect(hasPaidPackingFeeThisCycle([paid({ orderStatus: 'shipped' })])).toBe(true);
  });

  it('is true when any one of several orders paid', () => {
    expect(hasPaidPackingFeeThisCycle([
      paid({ packingFeePhp: 0 }), paid({ orderStatus: 'cancelled' }), paid(),
    ])).toBe(true);
  });
});

describe('packingFeeDueThisCycle', () => {
  it('charges the fee on the first order of a cycle', () => {
    expect(packingFeeDueThisCycle(150, false)).toBe(150);
  });

  it('charges nothing once the cycle is already paid for', () => {
    expect(packingFeeDueThisCycle(150, true)).toBe(0);
  });

  it('charges nothing when the listing carries no fee', () => {
    expect(packingFeeDueThisCycle(0, false)).toBe(0);
  });

  it('never returns a negative fee', () => {
    // A misconfigured listing must not credit the order.
    expect(packingFeeDueThisCycle(-150, false)).toBe(0);
  });
});
