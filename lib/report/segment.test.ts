// Which half of the weekly report an order belongs to.
//
// The batch order is sized off the Product Totals sheet, and until now that
// sheet mixed on-hand sales — already fulfilled from stock sitting in the
// stockroom — into the same kit counts as the vials still owed to the supplier.
// Splitting the report starts here, with the rule that decides which side an
// order falls on.
import { describe, it, expect } from 'vitest';
import { segmentOfOrder, partitionBySegment, SEGMENT_LABEL } from './segment';
import type { ReportOrderInput } from './build';

const order = (o: Partial<ReportOrderInput>): ReportOrderInput => ({
  orderNo: 'BBG-0001', status: 'payment_confirmed', createdAt: '2026-05-27T02:00:00Z',
  shipName: 'Gelly', shipPhone: '0912', customerEmail: 'g@x.com', shipAddress: 'Manila',
  courier: 'J&T', packedBy: 'Nova', paymentMethod: 'BDO', totalUsd: '10.00', totalPhp: '560.00',
  items: [{ nameSnapshot: 'Tirzepatide TR15', qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' }],
  ...o,
});

describe('segmentOfOrder', () => {
  it('files a solo order under on-hand', () => {
    expect(segmentOfOrder(order({ buyType: 'solo' }))).toBe('onhand');
  });

  it.each(['group_buy', 'moq'] as const)('files a %s order under group buy', (buyType) => {
    expect(segmentOfOrder(order({ buyType }))).toBe('groupbuy');
  });

  it('files a kahati order under its own report', () => {
    expect(segmentOfOrder(order({ buyType: 'kahati' }))).toBe('kahati');
  });

  it('falls back to the item kinds when the order carries no buy type', () => {
    // orders.buy_type is NOT NULL with a 'solo' default, so a row written before
    // the column was populated reads as on-hand even when its lines are hatian
    // vials. The item kind is the second, independent signal that catches it.
    const legacyKahati = order({
      buyType: undefined,
      items: [{ kind: 'group_buy', nameSnapshot: 'Reta — kahati', qty: 3, unitPriceUsd: null, unitPricePhp: '500.00' }],
    });

    expect(segmentOfOrder(legacyKahati)).toBe('kahati');
  });

  it('overrides a defaulted solo buy type when the lines are not on-hand', () => {
    const mislabelled = order({
      buyType: 'solo',
      items: [{ kind: 'moq_campaign', nameSnapshot: 'Pasabay batch', qty: 2, unitPriceUsd: null, unitPricePhp: '900.00' }],
    });

    expect(segmentOfOrder(mislabelled)).toBe('groupbuy');
  });

  it('treats an order with neither signal as on-hand', () => {
    // The pre-split default: every caller that has not been taught about
    // segments yet keeps producing the on-hand report it always produced.
    expect(segmentOfOrder(order({ buyType: undefined, items: [] }))).toBe('onhand');
  });
});

describe('partitionBySegment', () => {
  it('splits a mixed week without losing or duplicating an order', () => {
    const orders = [
      order({ orderNo: 'BBG-1', buyType: 'solo' }),
      order({ orderNo: 'BBG-2', buyType: 'kahati' }),
      order({ orderNo: 'BBG-3', buyType: 'moq' }),
      order({ orderNo: 'BBG-4', buyType: 'solo' }),
    ];

    const { onhand, groupbuy, kahati } = partitionBySegment(orders);

    expect(onhand.map((o) => o.orderNo)).toEqual(['BBG-1', 'BBG-4']);
    expect(groupbuy.map((o) => o.orderNo)).toEqual(['BBG-3']);
    expect(kahati.map((o) => o.orderNo)).toEqual(['BBG-2']);
  });

  it('preserves the incoming order within each half', () => {
    // The report numbers its rows by array position, so a partition that
    // reshuffled would renumber the sheet against the newest-first sort the
    // route applies.
    const orders = [
      order({ orderNo: 'BBG-9', buyType: 'group_buy' }),
      order({ orderNo: 'BBG-8', buyType: 'group_buy' }),
      order({ orderNo: 'BBG-7', buyType: 'group_buy' }),
    ];

    expect(partitionBySegment(orders).groupbuy.map((o) => o.orderNo)).toEqual(['BBG-9', 'BBG-8', 'BBG-7']);
  });

  it('returns empty halves for an empty week', () => {
    expect(partitionBySegment([])).toEqual({ onhand: [], groupbuy: [], kahati: [] });
  });
});

describe('SEGMENT_LABEL', () => {
  it('names all three reports for sheet titles and on-page headings', () => {
    expect(SEGMENT_LABEL.onhand).toBe('On-Hand');
    expect(SEGMENT_LABEL.groupbuy).toBe('Group Buy');
    expect(SEGMENT_LABEL.kahati).toBe('Kahati');
  });
});
