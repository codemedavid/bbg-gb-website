import { describe, it, expect } from 'vitest';
import { buildProductTotals } from './product-totals';
import type { ReportItem, ReportOrderInput } from './build';

const item = (i: Partial<ReportItem>): ReportItem => ({
  productId: 'p-tr15', nameSnapshot: 'Tirzepatide', specSnapshot: '15mg',
  code: 'TR15', kitSize: 10, qty: 10, unitPriceUsd: '6.80', unitPricePhp: '380.00',
  ...i,
});

const order = (o: Partial<ReportOrderInput>): ReportOrderInput => ({
  orderNo: 'BBG-0001', status: 'payment_confirmed', createdAt: '2026-03-17T02:00:00Z',
  shipName: 'Gelly', shipPhone: '0912', customerEmail: 'g@x.com', shipAddress: 'Manila',
  courier: 'J&T', packedBy: 'Nova', paymentMethod: 'BDO', totalUsd: '68.00', totalPhp: '3800.00',
  items: [item({})],
  ...o,
});

describe('buildProductTotals', () => {
  it('sums qty and USD for the same product across separate orders', () => {
    const r = buildProductTotals([
      order({ items: [item({ qty: 10 })] }),
      order({ orderNo: 'BBG-0002', items: [item({ qty: 9 })] }),
    ]);

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].qty).toBe(19);
    // 19 vials x $6.80
    expect(r.rows[0].usd).toBeCloseTo(129.2, 2);
  });

  it('carries the product name, code and spec onto the row', () => {
    const r = buildProductTotals([order({})]);

    expect(r.rows[0]).toMatchObject({
      index: 1, name: 'Tirzepatide', code: 'TR15', spec: '15mg',
    });
  });

  it('keeps two variants of the same product name as separate rows', () => {
    const r = buildProductTotals([
      order({
        items: [
          item({ productId: 'p-tr15', code: 'TR15', specSnapshot: '15mg', qty: 7 }),
          item({ productId: 'p-tr30', code: 'TR30', specSnapshot: '30mg', qty: 19 }),
        ],
      }),
    ]);

    expect(r.rows.map((x) => x.code)).toEqual(['TR30', 'TR15']);
  });

  it('groups items with no linked product by name and spec', () => {
    const r = buildProductTotals([
      order({
        items: [
          item({ productId: null, code: null, kitSize: null, nameSnapshot: 'Kahati vial', specSnapshot: '5mg', qty: 3 }),
          item({ productId: null, code: null, kitSize: null, nameSnapshot: 'Kahati vial', specSnapshot: '5mg', qty: 2 }),
          item({ productId: null, code: null, kitSize: null, nameSnapshot: 'Kahati vial', specSnapshot: '10mg', qty: 4 }),
        ],
      }),
    ]);

    expect(r.rows).toHaveLength(2);
    expect(r.rows.find((x) => x.spec === '5mg')?.qty).toBe(5);
    expect(r.rows.find((x) => x.spec === '10mg')?.qty).toBe(4);
  });

  it('ranks rows by total qty descending and numbers them from 1', () => {
    const r = buildProductTotals([
      order({
        items: [
          item({ productId: 'p-a', code: 'A', nameSnapshot: 'Alpha', qty: 5 }),
          item({ productId: 'p-b', code: 'B', nameSnapshot: 'Bravo', qty: 270 }),
          item({ productId: 'p-c', code: 'C', nameSnapshot: 'Charlie', qty: 40 }),
        ],
      }),
    ]);

    expect(r.rows.map((x) => [x.index, x.code])).toEqual([[1, 'B'], [2, 'C'], [3, 'A']]);
  });

  it('breaks a qty tie by USD descending, then by name', () => {
    const r = buildProductTotals([
      order({
        items: [
          item({ productId: 'p-a', code: 'A', nameSnapshot: 'Zulu', qty: 10, unitPriceUsd: '5.00' }),
          item({ productId: 'p-b', code: 'B', nameSnapshot: 'Alpha', qty: 10, unitPriceUsd: '9.00' }),
          item({ productId: 'p-c', code: 'C', nameSnapshot: 'Mike', qty: 10, unitPriceUsd: '5.00' }),
        ],
      }),
    ]);

    // B has the highest USD; A and C tie on both qty and USD, so name decides.
    expect(r.rows.map((x) => x.code)).toEqual(['B', 'C', 'A']);
  });

  it('converts qty into kits using the product kit size', () => {
    const r = buildProductTotals([
      order({
        items: [
          item({ productId: 'p-ba5', code: 'BA5', nameSnapshot: 'Liquid Bacteriostatic Water', kitSize: 10, qty: 270 }),
          item({ productId: 'p-lb50', code: 'LB50', nameSnapshot: 'Lemon Bottle', kitSize: 1, qty: 33 }),
        ],
      }),
    ]);

    expect(r.rows.find((x) => x.code === 'BA5')?.kits).toBe(27);
    expect(r.rows.find((x) => x.code === 'LB50')?.kits).toBe(33);
  });

  it('reports a partial kit as a fraction', () => {
    const r = buildProductTotals([order({ items: [item({ kitSize: 10, qty: 5 })] })]);
    expect(r.rows[0].kits).toBe(0.5);
  });

  it('counts an item with no known kit size as one kit per unit', () => {
    const r = buildProductTotals([
      order({ items: [item({ productId: null, code: null, kitSize: null, qty: 4 })] }),
    ]);

    expect(r.rows[0].kits).toBe(4);
  });

  it('excludes cancelled orders from the rollup', () => {
    const r = buildProductTotals([
      order({ items: [item({ qty: 10 })] }),
      order({ orderNo: 'BBG-0002', status: 'cancelled', items: [item({ qty: 99 })] }),
    ]);

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].qty).toBe(10);
    expect(r.totals.qty).toBe(10);
  });

  it('treats a missing USD price as zero rather than NaN', () => {
    const r = buildProductTotals([
      order({ items: [item({ unitPriceUsd: null, qty: 3 })] }),
    ]);

    expect(r.rows[0].usd).toBe(0);
    expect(r.rows[0].qty).toBe(3);
  });

  it('totals USD and qty across every row', () => {
    const r = buildProductTotals([
      order({
        items: [
          item({ productId: 'p-a', code: 'A', qty: 10, unitPriceUsd: '2.00' }),
          item({ productId: 'p-b', code: 'B', qty: 5, unitPriceUsd: '3.00' }),
        ],
      }),
    ]);

    expect(r.totals).toEqual({ usd: 35, qty: 15 });
  });

  it('returns an empty rollup when the week has no orders', () => {
    const r = buildProductTotals([]);

    expect(r.rows).toEqual([]);
    expect(r.totals).toEqual({ usd: 0, qty: 0 });
  });
});
