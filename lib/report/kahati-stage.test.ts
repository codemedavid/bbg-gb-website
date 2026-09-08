import { describe, it, expect } from 'vitest';
import { splitKahatiStageVials } from './kahati-stage';
import type { ReportOrderInput, ReportItem } from './build';

// A counter commitment as the weekly report carries it.
const line = (o: Partial<ReportItem> = {}): ReportItem => ({
  nameSnapshot: 'Retatrutide', qty: 3, unitPriceUsd: null, unitPricePhp: '1040',
  kind: 'group_buy', groupBuyId: 'gb1', counterKahatiVials: null,
  ...o,
});

const order = (o: Partial<ReportOrderInput> = {}): ReportOrderInput => ({
  orderNo: 'BBG-2418', status: 'payment_confirmed', buyType: 'kahati',
  createdAt: '2026-08-01T10:00:00.000Z',
  shipName: 'Ana Cruz', shipPhone: '09171234567', customerEmail: 'ana@example.com',
  shipAddress: '123 Mabini St, Manila', courier: null, packedBy: null,
  paymentMethod: 'GoTyme', totalUsd: null, totalPhp: '3120',
  items: [line()],
  ...o,
});

const at = (day: number): string => `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`;

describe('splitKahatiStageVials', () => {
  it('reports nothing for a range with no counter commitments', () => {
    const totals = splitKahatiStageVials([
      order({ buyType: 'solo', items: [line({ kind: 'product', groupBuyId: null })] }),
    ]);
    expect(totals).toEqual({ kahatiVials: 0, pasaloVials: 0, totalVials: 0, counters: 0 });
  });

  // Null kahati_vials means the admin never closed Kahati on that counter, so
  // Pasalo never ran and every vial on it is a Kahati vial.
  it('counts every vial as Kahati while the counter never went to Pasalo', () => {
    const totals = splitKahatiStageVials([
      order({ orderNo: 'a', createdAt: at(1), items: [line({ qty: 4, counterKahatiVials: null })] }),
    ]);
    expect(totals).toMatchObject({ kahatiVials: 4, pasaloVials: 0, totalVials: 4 });
  });

  // The client's rule, made visible: Pasalo vials are the vials that completed
  // the Kahati batch, so they belong to the same report — but the report has to
  // be able to say how many of them there were.
  it('splits a counter that went through Pasalo at its frozen Kahati count', () => {
    const totals = splitKahatiStageVials([
      order({ orderNo: 'a', createdAt: at(1), items: [line({ qty: 3, counterKahatiVials: 3 })] }),
      order({ orderNo: 'b', createdAt: at(2), items: [line({ qty: 2, counterKahatiVials: 3 })] }),
    ]);
    expect(totals).toMatchObject({ kahatiVials: 3, pasaloVials: 2, totalVials: 5, counters: 1 });
  });

  // Each counter is walked against its OWN frozen count. Walking every line in
  // one pass would let a full counter's vials push the next counter's first
  // joiner past a boundary that has nothing to do with them — and the Pasalo
  // figure would be nonsense on any range holding more than one counter.
  it('walks each counter against its own boundary', () => {
    const totals = splitKahatiStageVials([
      order({ orderNo: 'a', createdAt: at(1), items: [line({ groupBuyId: 'gb1', qty: 5, counterKahatiVials: 5 })] }),
      order({ orderNo: 'b', createdAt: at(2), items: [line({ groupBuyId: 'gb1', qty: 2, counterKahatiVials: 5 })] }),
      // A different counter, also 5 frozen — its first joiner is a Kahati vial.
      order({ orderNo: 'c', createdAt: at(3), items: [line({ groupBuyId: 'gb2', qty: 4, counterKahatiVials: 5 })] }),
    ]);
    expect(totals).toMatchObject({ kahatiVials: 9, pasaloVials: 2, totalVials: 11, counters: 2 });
  });

  // A cancelled order's vials are not being ordered from the supplier, so they
  // count for neither stage — the same rule the rest of the report applies.
  it('leaves a cancelled order out of both stages', () => {
    const totals = splitKahatiStageVials([
      order({ orderNo: 'gone', status: 'cancelled', createdAt: at(1), items: [line({ qty: 3, counterKahatiVials: 3 })] }),
      order({ orderNo: 'b', createdAt: at(2), items: [line({ qty: 2, counterKahatiVials: 3 })] }),
    ]);
    expect(totals).toMatchObject({ kahatiVials: 2, pasaloVials: 0, totalVials: 2 });
  });

  // On-hand and MOQ lines reference no counter. They belong to other reports and
  // must not be counted as vials either stage filled.
  it('ignores lines that reference no counter', () => {
    const totals = splitKahatiStageVials([
      order({
        orderNo: 'a', createdAt: at(1),
        items: [
          line({ qty: 3, counterKahatiVials: 3 }),
          line({ kind: 'product', groupBuyId: null, qty: 9 }),
          line({ kind: 'moq_product', groupBuyId: null, qty: 7 }),
        ],
      }),
    ]);
    expect(totals).toMatchObject({ kahatiVials: 3, pasaloVials: 0, totalVials: 3 });
  });

  // The two halves are a split of the whole, not two independent counts. If they
  // ever stop adding up, the batch order and the stage breakdown disagree about
  // the same vials.
  it('always splits the total, never changes it', () => {
    const totals = splitKahatiStageVials([
      order({ orderNo: 'a', createdAt: at(1), items: [line({ groupBuyId: 'gb1', qty: 6, counterKahatiVials: 4 })] }),
      order({ orderNo: 'b', createdAt: at(2), items: [line({ groupBuyId: 'gb2', qty: 3, counterKahatiVials: null })] }),
    ]);
    expect(totals.kahatiVials + totals.pasaloVials).toBe(totals.totalVials);
  });
});
