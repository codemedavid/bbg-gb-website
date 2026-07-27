// The downpayment is asked for ONCE while a commitment is live — not once per
// hatian joined. These are the rules with no database in sight.
import { describe, it, expect } from 'vitest';
import {
  hasOpenKahatiCommitment,
  kahatiDownpaymentDue,
  summarizeKahatiCommitments,
  type KahatiCommitment,
} from './kahati-commitment';

const commitment = (o: Partial<KahatiCommitment> = {}): KahatiCommitment => ({
  orderId: 'o1',
  orderNo: 'BBG-2418',
  kahatiId: 'g1',
  kahatiName: 'Reta 20mg',
  kahatiStatus: 'open',
  qty: 2,
  lineTotalPhp: 1800,
  placedAt: '2026-07-01T00:00:00.000Z',
  ...o,
});

describe('hasOpenKahatiCommitment', () => {
  it('is false for a customer who has never joined a hatian', () => {
    expect(hasOpenKahatiCommitment([])).toBe(false);
  });

  it('is true while the hatian they already joined is still open', () => {
    expect(hasOpenKahatiCommitment([commitment({ kahatiStatus: 'open' })])).toBe(true);
  });

  it('is false once every hatian they joined has sealed', () => {
    // A sealed counter's parcel is on its way out; the next join starts a fresh
    // commitment and pays its own downpayment.
    expect(hasOpenKahatiCommitment([
      commitment({ kahatiStatus: 'closed' }),
      commitment({ kahatiId: 'g2', kahatiStatus: 'shipped' }),
    ])).toBe(false);
  });

  it('holds across different hatians — any open one counts, not just the same product', () => {
    expect(hasOpenKahatiCommitment([
      commitment({ kahatiId: 'g1', kahatiName: 'Reta 20mg', kahatiStatus: 'closed' }),
      commitment({ kahatiId: 'g2', kahatiName: 'Tirze 30mg', kahatiStatus: 'open' }),
    ])).toBe(true);
  });
});

describe('kahatiDownpaymentDue', () => {
  it('charges the downpayment on a first commitment', () => {
    expect(kahatiDownpaymentDue(1800, 150, false)).toBe(150);
  });

  it('charges nothing when a commitment is already live', () => {
    expect(kahatiDownpaymentDue(1800, 150, true)).toBe(0);
  });

  it('never exceeds the order total on a first commitment', () => {
    expect(kahatiDownpaymentDue(90, 150, false)).toBe(90);
  });
});

describe('summarizeKahatiCommitments', () => {
  it('reports nothing for a customer with no live commitments', () => {
    expect(summarizeKahatiCommitments([])).toEqual({
      groups: [], vials: 0, totalPhp: 0, orderCount: 0,
    });
  });

  it('totals the vials and pesos a customer already holds', () => {
    const summary = summarizeKahatiCommitments([
      commitment({ orderId: 'o1', orderNo: 'BBG-1', qty: 2, lineTotalPhp: 1800 }),
      commitment({ orderId: 'o2', orderNo: 'BBG-2', kahatiId: 'g2', kahatiName: 'Tirze 30mg', qty: 3, lineTotalPhp: 3000 }),
    ]);

    expect(summary.vials).toBe(5);
    expect(summary.totalPhp).toBe(4800);
    expect(summary.orderCount).toBe(2);
  });

  it('groups rollover siblings under one hatian name', () => {
    // A counter that fills seals and opens a fresh sibling carrying the same
    // name. To the customer that is one hatian, so it reads as one line.
    const summary = summarizeKahatiCommitments([
      commitment({ orderId: 'o1', orderNo: 'BBG-1', kahatiId: 'g1', qty: 6, lineTotalPhp: 5400 }),
      commitment({ orderId: 'o2', orderNo: 'BBG-2', kahatiId: 'g1-sibling', qty: 4, lineTotalPhp: 3600 }),
    ]);

    expect(summary.groups).toEqual([
      { kahatiName: 'Reta 20mg', vials: 10, totalPhp: 9000, orderNos: ['BBG-1', 'BBG-2'] },
    ]);
  });

  it('counts an order once even when it spans two counters of the same hatian', () => {
    // An overflow commitment writes two lines against one order: the counter it
    // filled and the sibling that fill opened.
    const summary = summarizeKahatiCommitments([
      commitment({ orderId: 'o1', orderNo: 'BBG-1', kahatiId: 'g1', qty: 8, lineTotalPhp: 7200 }),
      commitment({ orderId: 'o1', orderNo: 'BBG-1', kahatiId: 'g2', qty: 2, lineTotalPhp: 1800 }),
    ]);

    expect(summary.orderCount).toBe(1);
    expect(summary.vials).toBe(10);
    expect(summary.groups[0].orderNos).toEqual(['BBG-1']);
  });
});
