import { describe, it, expect } from 'vitest';
import { buildWeeklyReport, type ReportOrderInput } from './build';

const order = (o: Partial<ReportOrderInput>): ReportOrderInput => ({
  orderNo: 'BBG-0001', status: 'payment_confirmed', createdAt: '2026-05-27T02:00:00Z',
  shipName: 'Gelly', shipPhone: '0912', customerEmail: 'g@x.com', shipAddress: 'Manila',
  courier: 'J&T', packedBy: 'Nova', paymentMethod: 'BDO', totalUsd: '10.00', totalPhp: '560.00',
  items: [{ nameSnapshot: 'Tirzepatide TR15', qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' }],
  ...o,
});

describe('buildWeeklyReport', () => {
  it('numbers rows and maps status to report wording', () => {
    const r = buildWeeklyReport('2026-05-25', [order({ status: 'proof_review' })]);
    expect(r.rows[0].index).toBe(1);
    expect(r.rows[0].status).toBe('Payment Verification');
  });

  it('formats the USD product line and Manila date', () => {
    const r = buildWeeklyReport('2026-05-25', [order({})]);
    expect(r.rows[0].products).toEqual(['Tirzepatide TR15 x5 @ $6.80']);
    expect(r.rows[0].date).toBe('5/27/2026');
    expect(r.rows[0].contact).toBe('0912\ng@x.com');
  });

  it('omits the "@ $" suffix when a line has no USD price', () => {
    const r = buildWeeklyReport('2026-05-25', [order({
      items: [{ nameSnapshot: 'Kahati vial', qty: 3, unitPriceUsd: null, unitPricePhp: '500.00' }],
    })]);
    expect(r.rows[0].products).toEqual(['Kahati vial x3']);
  });

  it('counts paid / pending / cancelled and excludes cancelled from totals', () => {
    const r = buildWeeklyReport('2026-05-25', [
      order({ status: 'payment_confirmed', totalUsd: '10.00', totalPhp: '560.00' }),
      order({ status: 'proof_review', totalUsd: '5.00', totalPhp: '280.00' }),
      order({ status: 'cancelled', totalUsd: '99.00', totalPhp: '9999.00' }),
    ]);
    expect(r.counts).toEqual({ paid: 1, pending: 1, cancelled: 1 });
    expect(r.totals).toEqual({ usd: 15, php: 840 });
    expect(r.orderCount).toBe(3);
  });

  it('carries the week metadata', () => {
    const r = buildWeeklyReport('2026-05-25', []);
    expect(r.weekNo).toBe(22);
    expect(r.rangeLabel).toBe('Mon May 25 – Sun May 31');
  });
});
