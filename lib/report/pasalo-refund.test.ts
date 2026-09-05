import { describe, it, expect } from 'vitest';
import {
  buildCustomerRefundRows, buildBatchSummaryRows, buildBatchTotals, refundReportFilename,
  type RefundRecord, type SuccessfulItem, type CounterOutcome,
} from './pasalo-refund';

const refund = (over: Partial<RefundRecord> = {}): RefundRecord => ({
  id: 'r1', orderItemId: 'i1', orderId: 'o1', orderNo: 'KH-1001', groupBuyId: 'gB',
  userId: 'u1', customerName: 'Juan Dela Cruz', customerEmail: 'juan@example.com',
  customerPhone: '09171234567', shipName: 'Juan Dela Cruz', shipPhone: '09171234567',
  productName: 'Cagrilintide 5mg — kahati', qty: 1, unitPricePhp: 300, lineTotalPhp: 300,
  goodsPhp: 300, depositPhp: 0, amountPhp: 300, collectedBasis: 'settlement_paid',
  reason: 'Final combined quantity 5/7 minimum after Pasalo closed (3 Kahati + 2 Pasalo).',
  kahatiVials: 3, pasaloVials: 2, combinedVials: 5, minRequired: 7,
  status: 'pending', reference: null, method: null, refundAccount: null,
  refundedAt: null, notes: null, paymentMethod: 'GCash', orderedOn: '2026-09-01', ...over,
});

const success = (over: Partial<SuccessfulItem> = {}): SuccessfulItem => ({
  userId: 'u1', groupBuyId: 'gA', customerName: 'Juan Dela Cruz',
  customerEmail: 'juan@example.com', customerPhone: '09171234567',
  orderNo: 'KH-1001', orderItemId: 'ok1', productName: 'Retatrutide 15mg — kahati',
  qty: 1, unitPricePhp: 500, lineTotalPhp: 500,
  kahatiVials: 9, pasaloVials: 0, combinedVials: 9, minRequired: 7,
  fulfilmentStatus: 'payment_confirmed', ...over,
});

describe('buildCustomerRefundRows — the brief\'s worked example', () => {
  // CUSTOMER A
  //   Order #1001 — Product A SUCCESS ₱500, Product B FAILED ₱300
  //   Order #1042 — Product B FAILED ₱300, Product C SUCCESS ₱600
  //   relevant ₱1,700 · successful ₱1,100 · refund ₱600
  const refunds = [
    refund({ id: 'r1', orderItemId: 'b1', orderNo: 'KH-1001', lineTotalPhp: 300, goodsPhp: 300, amountPhp: 300 }),
    refund({ id: 'r2', orderItemId: 'b2', orderNo: 'KH-1042', orderId: 'o2', lineTotalPhp: 300, goodsPhp: 300, amountPhp: 300 }),
  ];
  const successful = [
    success({ orderItemId: 'a1', orderNo: 'KH-1001', groupBuyId: 'gA', lineTotalPhp: 500 }),
    success({ orderItemId: 'c1', orderNo: 'KH-1042', groupBuyId: 'gC', lineTotalPhp: 600 }),
  ];

  it('consolidates the customer into a single row', () => {
    expect(buildCustomerRefundRows(refunds, successful)).toHaveLength(1);
  });

  it('reproduces the three figures exactly', () => {
    const [row] = buildCustomerRefundRows(refunds, successful);
    expect(row.relevantPaidPhp).toBe(1700);
    expect(row.successfulPhp).toBe(1100);
    expect(row.totalRefundPhp).toBe(600);
  });

  it('lists both order numbers without repeating either', () => {
    const [row] = buildCustomerRefundRows(refunds, successful);
    expect(row.orderNos).toBe('KH-1001, KH-1042');
  });

  it('counts the failed items rather than the orders', () => {
    const [row] = buildCustomerRefundRows(refunds, successful);
    expect(row.failedItems).toBe(2);
  });
});

describe('buildCustomerRefundRows — status roll-up', () => {
  it('reads a half-paid customer as the LEAST settled of their rows', () => {
    // The row an admin works from. Rolling this up to "Refunded" on the
    // strength of one transfer is how the second half never gets sent.
    const rows = buildCustomerRefundRows(
      [refund({ id: 'a', orderItemId: 'a', status: 'refunded' }),
        refund({ id: 'b', orderItemId: 'b', status: 'pending' })],
      [],
    );
    expect(rows[0].status).toBe('pending');
  });

  it('surfaces a failed transfer above a merely pending one', () => {
    const rows = buildCustomerRefundRows(
      [refund({ id: 'a', orderItemId: 'a', status: 'pending' }),
        refund({ id: 'b', orderItemId: 'b', status: 'failed' })],
      [],
    );
    expect(rows[0].status).toBe('failed');
  });

  it('only stamps a refund date once every one of their lines is paid', () => {
    const rows = buildCustomerRefundRows(
      [refund({ id: 'a', orderItemId: 'a', status: 'refunded', refundedAt: new Date('2026-09-06') }),
        refund({ id: 'b', orderItemId: 'b', status: 'pending' })],
      [],
    );
    expect(rows[0].refundedAt).toBeNull();
  });
});

describe('buildCustomerRefundRows — separation between customers', () => {
  it('keeps two customers apart and sorts them by name', () => {
    const rows = buildCustomerRefundRows(
      [refund({ id: 'a', orderItemId: 'a', userId: 'u2', shipName: 'Zeny Reyes' }),
        refund({ id: 'b', orderItemId: 'b', userId: 'u1', shipName: 'Ana Lim' })],
      [],
    );
    expect(rows.map((r) => r.customerName)).toEqual(['Ana Lim', 'Zeny Reyes']);
  });

  it('never credits one customer with another\'s successful items', () => {
    const rows = buildCustomerRefundRows(
      [refund({ userId: 'u1' })],
      [success({ userId: 'u2', lineTotalPhp: 9999 })],
    );
    expect(rows[0].successfulPhp).toBe(0);
  });

  it('prefers the delivery snapshot over the account name', () => {
    // Who the parcel was actually for, and it cannot change under an admin
    // looking at a batch already packed.
    const rows = buildCustomerRefundRows(
      [refund({ customerName: 'Account Holder', shipName: 'Maria Santos' })], [],
    );
    expect(rows[0].customerName).toBe('Maria Santos');
  });
});

describe('buildBatchSummaryRows', () => {
  const counter = (over: Partial<CounterOutcome> = {}): CounterOutcome => ({
    groupBuyId: 'gB', productName: 'Cagrilintide 5mg',
    kahatiVials: 3, pasaloVials: 2, combinedVials: 5, minRequired: 7, maxVials: 10,
    neededToQualify: 2, slotsRemaining: 5, status: 'cancelled', paymentConfirmedVials: 4, ...over,
  });

  it('marks a counter below the minimum FAILED and totals its refunds', () => {
    const [row] = buildBatchSummaryRows(
      [counter()],
      [refund({ groupBuyId: 'gB', amountPhp: 300 }), refund({ id: 'r2', orderItemId: 'i2', groupBuyId: 'gB', userId: 'u2', amountPhp: 300 })],
      [],
    );
    expect(row.outcome).toBe('FAILED');
    expect(row.refundValuePhp).toBe(600);
    expect(row.customersAffected).toBe(2);
  });

  it('marks a counter at or above the minimum SUCCESS', () => {
    const [row] = buildBatchSummaryRows(
      [counter({ groupBuyId: 'gA', combinedVials: 7, neededToQualify: 0, status: 'closed' })], [], [],
    );
    expect(row.outcome).toBe('SUCCESS');
    expect(row.refundValuePhp).toBe(0);
  });

  it('does not attribute one counter\'s refunds to another', () => {
    const rows = buildBatchSummaryRows(
      [counter({ groupBuyId: 'gB' }), counter({ groupBuyId: 'gC', productName: 'Other' })],
      [refund({ groupBuyId: 'gB', amountPhp: 300 })],
      [],
    );
    expect(rows[0].refundValuePhp).toBe(300);
    expect(rows[1].refundValuePhp).toBe(0);
  });
});

describe('buildBatchTotals', () => {
  it('totals refunds from the refund rows, so a deposit is not dropped', () => {
    // A deposit is attached to one line and belongs to no single product, so
    // summing the per-product column would lose it.
    const counters: CounterOutcome[] = [{
      groupBuyId: 'gB', productName: 'Cagrilintide 5mg', kahatiVials: 3, pasaloVials: 2,
      combinedVials: 5, minRequired: 7, maxVials: 10, neededToQualify: 2, slotsRemaining: 5,
      status: 'cancelled', paymentConfirmedVials: 4,
    }];
    const refunds = [refund({ groupBuyId: null, goodsPhp: 0, depositPhp: 150, amountPhp: 150 })];
    const rows = buildBatchSummaryRows(counters, refunds, []);
    expect(rows[0].refundValuePhp).toBe(0);
    expect(buildBatchTotals(rows, refunds).refundValuePhp).toBe(150);
  });

  it('counts people, not rows', () => {
    const totals = buildBatchTotals([], [
      refund({ id: 'a', orderItemId: 'a', userId: 'u1' }),
      refund({ id: 'b', orderItemId: 'b', userId: 'u1' }),
      refund({ id: 'c', orderItemId: 'c', userId: 'u2' }),
    ]);
    expect(totals.customersRequiringRefund).toBe(2);
  });
});

describe('refundReportFilename', () => {
  it('names the batch and the date', () => {
    expect(refundReportFilename('Batch 7', new Date('2026-09-05T08:00:00Z')))
      .toBe('BBG-Refund-Report-Batch-7-2026-09-05.xlsx');
  });
  it('falls back to the date alone when the batch is unnamed', () => {
    expect(refundReportFilename('  ', new Date('2026-09-05T08:00:00Z')))
      .toBe('BBG-Refund-Report-2026-09-05.xlsx');
  });
  it('strips characters a file system would refuse', () => {
    expect(refundReportFilename('Sept 1–7 / kahati', new Date('2026-09-05T08:00:00Z')))
      .toBe('BBG-Refund-Report-Sept-1-7-kahati-2026-09-05.xlsx');
  });
});
