import { describe, it, expect } from 'vitest';
import { buildBuyerSummary } from './buyer-summary';
import type { ReportOrderInput } from './build';

const order = (o: Partial<ReportOrderInput>): ReportOrderInput => ({
  orderNo: 'GB-2559', status: 'payment_confirmed', createdAt: '2026-05-27T02:00:00Z',
  shipName: 'Abba Gaspar', shipPhone: '0912', customerEmail: 'a@x.com', shipAddress: 'Manila',
  courier: 'J&T', packedBy: 'Nova', paymentMethod: 'BDO', totalUsd: '0', totalPhp: '5950',
  items: [],
  ...o,
});

const item = (code: string, qty: number, unitPricePhp: string) => ({
  nameSnapshot: code, code, qty, unitPriceUsd: null, unitPricePhp,
});

describe('buildBuyerSummary', () => {
  it('rolls each buyer up to their lines, quantity and peso amount', () => {
    const summary = buildBuyerSummary([
      order({ items: [item('RJ HB', 1, '2500'), item('RJ HEALER', 1, '3450')] }),
    ]);

    expect(summary.groups).toEqual([{
      buyer: 'Abba Gaspar',
      qty: 2,
      amountPhp: 5950,
      lines: [
        { label: 'RJ HB', qty: 1, amountPhp: 2500 },
        { label: 'RJ HEALER', qty: 1, amountPhp: 3450 },
      ],
    }]);
    expect(summary.totals).toEqual({ qty: 2, amountPhp: 5950 });
  });

  // The pivot is per buyer, not per order. A customer who checked out three
  // times in the range is one row with their whole batch under it — which is
  // the question the sheet is opened to answer.
  it('merges a buyer across several orders and sums repeats of one product', () => {
    const summary = buildBuyerSummary([
      order({ orderNo: 'GB-1', items: [item('BAC3', 1, '475')] }),
      order({ orderNo: 'GB-2', items: [item('BAC3', 2, '475'), item('TR30', 1, '4850')] }),
    ]);

    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].lines).toEqual([
      { label: 'BAC3', qty: 3, amountPhp: 1425 },
      { label: 'TR30', qty: 1, amountPhp: 4850 },
    ]);
    expect(summary.groups[0].qty).toBe(4);
    expect(summary.groups[0].amountPhp).toBe(6275);
  });

  // The client's ask: the totals must include the packing fee, so a buyer's
  // figure reconciles to what they actually paid rather than to the goods only.
  it("adds each buyer's packing fee as its own line without inflating quantity", () => {
    const summary = buildBuyerSummary([
      order({ items: [item('TR30', 1, '4850')], packingFeePhp: '150' }),
    ]);

    expect(summary.groups[0].lines).toEqual([
      { label: 'TR30', qty: 1, amountPhp: 4850 },
      { label: 'Packing fee', qty: 0, amountPhp: 150 },
    ]);
    // Quantity counts vials, not fees.
    expect(summary.groups[0].qty).toBe(1);
    expect(summary.groups[0].amountPhp).toBe(5000);
    expect(summary.totals).toEqual({ qty: 1, amountPhp: 5000 });
  });

  it('sums the packing fee across a buyer several orders and omits a zero fee', () => {
    const summary = buildBuyerSummary([
      order({ orderNo: 'GB-1', items: [item('TR30', 1, '4850')], packingFeePhp: '150' }),
      order({ orderNo: 'GB-2', items: [item('BAC3', 1, '475')], packingFeePhp: '0' }),
    ]);

    const fees = summary.groups[0].lines.filter((l) => l.label === 'Packing fee');
    expect(fees).toEqual([{ label: 'Packing fee', qty: 0, amountPhp: 150 }]);
  });

  it('omits the packing fee line entirely when a buyer paid none', () => {
    const summary = buildBuyerSummary([order({ items: [item('TR30', 1, '4850')] })]);
    expect(summary.groups[0].lines.map((l) => l.label)).toEqual(['TR30']);
  });

  // Same exclusion the money totals use: nobody is shipping or billing those.
  it('excludes cancelled orders', () => {
    const summary = buildBuyerSummary([
      order({ items: [item('TR30', 1, '4850')] }),
      order({ status: 'cancelled', shipName: 'Ghost', items: [item('TR30', 9, '4850')], packingFeePhp: '999' }),
    ]);

    expect(summary.groups.map((g) => g.buyer)).toEqual(['Abba Gaspar']);
    expect(summary.totals).toEqual({ qty: 1, amountPhp: 4850 });
  });

  it('sorts buyers alphabetically and keeps the packing fee last within a buyer', () => {
    const summary = buildBuyerSummary([
      order({ shipName: 'Venice Gaa', items: [item('TR30', 1, '4850')], packingFeePhp: '150' }),
      order({ shipName: 'Abba Gaspar', items: [item('RJ HB', 1, '2500')] }),
    ]);

    expect(summary.groups.map((g) => g.buyer)).toEqual(['Abba Gaspar', 'Venice Gaa']);
    expect(summary.groups[1].lines.map((l) => l.label)).toEqual(['TR30', 'Packing fee']);
  });

  it('falls back to the name snapshot when a line carries no price-list code', () => {
    const summary = buildBuyerSummary([
      order({ items: [{ nameSnapshot: 'Kahati vial', qty: 2, unitPriceUsd: null, unitPricePhp: '500' }] }),
    ]);

    expect(summary.groups[0].lines[0].label).toBe('Kahati vial');
  });

  it('rounds money to centavos so float drift stays out of the sheet', () => {
    const summary = buildBuyerSummary([
      order({ items: [item('TR30', 3, '456.25')] }),
    ]);

    expect(summary.groups[0].amountPhp).toBe(1368.75);
  });

  it('returns empty totals for an empty range', () => {
    expect(buildBuyerSummary([])).toEqual({ groups: [], totals: { qty: 0, amountPhp: 0 } });
  });
});
