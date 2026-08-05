import { describe, it, expect } from 'vitest';
import { buildSegmentedWeeklyReport, buildWeeklyReport, type ReportOrderInput } from './build';

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

  it('attaches the per-product rollup alongside the per-order rows', () => {
    const r = buildWeeklyReport('2026-05-25', [
      order({
        items: [
          { productId: 'p-tr15', nameSnapshot: 'Tirzepatide', specSnapshot: '15mg', code: 'TR15', kitSize: 10, qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' },
        ],
      }),
    ]);

    expect(r.productTotals.rows).toHaveLength(1);
    expect(r.productTotals.rows[0]).toMatchObject({ code: 'TR15', qty: 5, kits: 0.5 });
    expect(r.productTotals.totals.qty).toBe(5);
  });
});

describe('buildSegmentedWeeklyReport', () => {
  // A week holding both kinds of business: one on-hand sale off the shelf and
  // one hatian commitment against the next batch.
  const mixedWeek = (): ReportOrderInput[] => [
    order({
      orderNo: 'BBG-0001', buyType: 'solo', totalUsd: '10.00', totalPhp: '560.00',
      items: [{ kind: 'product', productId: 'p-tr15', nameSnapshot: 'Tirzepatide', specSnapshot: '15mg', code: 'TR15', kitSize: 10, qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' }],
    }),
    order({
      orderNo: 'BBG-0002', buyType: 'kahati', status: 'proof_review', totalUsd: '0.00', totalPhp: '1500.00',
      items: [{ kind: 'group_buy', nameSnapshot: 'Retatrutide — kahati', qty: 3, unitPriceUsd: null, unitPricePhp: '500.00', kitSize: 10 }],
    }),
  ];

  it('returns one report per half of the week', () => {
    const { onhand, groupbuy } = buildSegmentedWeeklyReport('2026-05-25', mixedWeek());

    expect(onhand.rows.map((r) => r.invoice)).toEqual(['BBG-0001']);
    expect(groupbuy.rows.map((r) => r.invoice)).toEqual(['BBG-0002']);
  });

  it('keeps the batch-order rollup free of on-hand stock', () => {
    // The whole point of the split: an on-hand sale is already fulfilled from
    // the stockroom, so counting it toward the kits owed to the supplier
    // over-orders. The kahati rollup must name only the hatian line.
    const { groupbuy } = buildSegmentedWeeklyReport('2026-05-25', mixedWeek());

    expect(groupbuy.productTotals.rows.map((r) => r.name)).toEqual(['Retatrutide — kahati']);
    expect(groupbuy.productTotals.totals.qty).toBe(3);
  });

  it('keeps the on-hand rollup free of pre-ordered vials', () => {
    const { onhand } = buildSegmentedWeeklyReport('2026-05-25', mixedWeek());

    expect(onhand.productTotals.rows.map((r) => r.code)).toEqual(['TR15']);
    expect(onhand.productTotals.totals.qty).toBe(5);
  });

  it('counts and totals each half independently', () => {
    const { onhand, groupbuy } = buildSegmentedWeeklyReport('2026-05-25', mixedWeek());

    expect(onhand.orderCount).toBe(1);
    expect(onhand.counts).toEqual({ paid: 1, pending: 0, cancelled: 0 });
    expect(onhand.totals).toEqual({ usd: 10, php: 560 });

    expect(groupbuy.orderCount).toBe(1);
    expect(groupbuy.counts).toEqual({ paid: 0, pending: 1, cancelled: 0 });
    expect(groupbuy.totals).toEqual({ usd: 0, php: 1500 });
  });

  it('numbers each half from 1 rather than carrying the week-wide index', () => {
    const { groupbuy } = buildSegmentedWeeklyReport('2026-05-25', mixedWeek());

    expect(groupbuy.rows[0].index).toBe(1);
  });

  it('carries the same week metadata onto both halves', () => {
    const { onhand, groupbuy } = buildSegmentedWeeklyReport('2026-05-25', []);

    for (const half of [onhand, groupbuy]) {
      expect(half.weekNo).toBe(22);
      expect(half.rangeLabel).toBe('Mon May 25 – Sun May 31');
      expect(half.rows).toEqual([]);
    }
  });

  it('still excludes cancelled orders from the half they land in', () => {
    const { groupbuy } = buildSegmentedWeeklyReport('2026-05-25', [
      order({ orderNo: 'BBG-0003', buyType: 'kahati', status: 'cancelled', totalUsd: '99.00', totalPhp: '9999.00' }),
      order({ orderNo: 'BBG-0004', buyType: 'kahati', status: 'payment_confirmed', totalUsd: '10.00', totalPhp: '560.00' }),
    ]);

    expect(groupbuy.counts).toEqual({ paid: 1, pending: 0, cancelled: 1 });
    expect(groupbuy.totals).toEqual({ usd: 10, php: 560 });
  });
});
