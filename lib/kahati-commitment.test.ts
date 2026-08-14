// The downpayment is asked for ONCE while a commitment is live — not once per
// hatian joined. These are the rules with no database in sight.
import { describe, it, expect } from 'vitest';
import {
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
