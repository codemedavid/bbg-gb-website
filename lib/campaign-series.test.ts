// Grouping the admin campaign board by series.
//
// The board had grown to one card per batch — 226 of them, most finished — and
// a finished batch is history, not work. Grouping turns that into one entry per
// group buy: the batch that is live now, with every batch before it archived
// behind it in batch order so the admin can still read Batch #1.
import { describe, it, expect } from 'vitest';
import { groupBySeries, type SeriesGroup } from './campaign-series';
import type { MoqCampaign } from './types';

const batch = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'b1', name: 'BAC Water 3ml', pricePerKitPhp: '475.00', moq: 10, committed: 0,
  perCustomerMin: 1, shippingPhp: '300.00', status: 'open', opensAt: null, deadline: null,
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-08-01T00:00:00.000Z', seriesId: 's1', batchNo: 1,
  capacity: 10, progress: 0, remaining: 10, reached: false, full: false,
  outcome: 'awaiting_moq',
  ...o,
});

const ids = (g: SeriesGroup) => g.past.map((b) => b.id);

describe('grouping the board by series', () => {
  it('collects every batch of one series into a single group', () => {
    const groups = groupBySeries([
      batch({ id: 'b1', batchNo: 1, status: 'completed' }),
      batch({ id: 'b2', batchNo: 2, status: 'open' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('BAC Water 3ml');
  });

  it('keeps separate series apart even when they share a name', () => {
    const groups = groupBySeries([
      batch({ id: 'b1', seriesId: 's1' }),
      batch({ id: 'b2', seriesId: 's2' }),
    ]);

    expect(groups).toHaveLength(2);
  });

  // What the admin came to see: the batch still taking kits.
  it('fronts the group with the live batch, not the newest finished one', () => {
    const groups = groupBySeries([
      batch({ id: 'old', batchNo: 3, status: 'completed' }),
      batch({ id: 'live', batchNo: 2, status: 'open' }),
    ]);

    expect(groups[0].current.id).toBe('live');
  });

  it('treats scheduled and approved batches as live', () => {
    expect(groupBySeries([
      batch({ id: 'done', batchNo: 1, status: 'completed' }),
      batch({ id: 'next', batchNo: 2, status: 'approved' }),
    ])[0].current.id).toBe('next');

    expect(groupBySeries([
      batch({ id: 'done', seriesId: 's9', batchNo: 1, status: 'cancelled' }),
      batch({ id: 'soon', seriesId: 's9', batchNo: 2, status: 'scheduled' }),
    ])[0].current.id).toBe('soon');
  });

  // A series that ended must not vanish from the board — the admin still has to
  // reach its participants and its history.
  it('fronts a fully finished series with its last batch', () => {
    const groups = groupBySeries([
      batch({ id: 'b1', batchNo: 1, status: 'completed' }),
      batch({ id: 'b2', batchNo: 2, status: 'cancelled' }),
    ]);

    expect(groups[0].current.id).toBe('b2');
    expect(ids(groups[0])).toEqual(['b1']);
  });

  it('archives the remaining batches newest first', () => {
    const groups = groupBySeries([
      batch({ id: 'b1', batchNo: 1, status: 'completed' }),
      batch({ id: 'b3', batchNo: 3, status: 'completed' }),
      batch({ id: 'b2', batchNo: 2, status: 'completed' }),
      batch({ id: 'b4', batchNo: 4, status: 'open' }),
    ]);

    expect(ids(groups[0])).toEqual(['b3', 'b2', 'b1']);
  });

  it('leaves a one-batch series with nothing archived', () => {
    expect(groupBySeries([batch()])[0].past).toEqual([]);
  });

  // Two live batches in one series should not happen — every path that opens one
  // first completes its predecessor — but a hand-written row must not silently
  // hide the other, so the older live batch is archived rather than dropped.
  it('keeps a second live batch reachable in the archive', () => {
    const groups = groupBySeries([
      batch({ id: 'b1', batchNo: 1, status: 'open' }),
      batch({ id: 'b2', batchNo: 2, status: 'open' }),
    ]);

    expect(groups[0].current.id).toBe('b2');
    expect(ids(groups[0])).toEqual(['b1']);
  });

  it('orders groups by name so a long board can be scanned', () => {
    const groups = groupBySeries([
      batch({ id: 'b1', seriesId: 's1', name: 'Tirzepatide 30mg vial' }),
      batch({ id: 'b2', seriesId: 's2', name: 'BAC Water 5ml' }),
    ]);

    expect(groups.map((g) => g.name)).toEqual(['BAC Water 5ml', 'Tirzepatide 30mg vial']);
  });

  it('counts an empty board as no groups at all', () => {
    expect(groupBySeries([])).toEqual([]);
  });
});
