// Kahati and Pasalo share one report. The data already did — a Pasalo
// commitment is buy_type 'kahati' and lands in the Kahati half — but the card
// never said so, so an admin reading a sheet headed "Kahati" had no way to know
// Pasalo vials were in the batch order, or how many of them there were.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SegmentReport } from './SegmentReport';
import { buildWeeklyReport, type ReportOrderInput } from '@/lib/report/build';

const counterLine = (qty: number, frozen: number | null) => ({
  nameSnapshot: 'Retatrutide', qty, unitPriceUsd: null, unitPricePhp: '1040',
  kind: 'group_buy', groupBuyId: 'gb1', counterKahatiVials: frozen,
});

const order = (o: Partial<ReportOrderInput>): ReportOrderInput => ({
  orderNo: 'BBG-0001', status: 'payment_confirmed', buyType: 'kahati',
  createdAt: '2026-05-27T02:00:00Z',
  shipName: 'Gelly', shipPhone: '0912', customerEmail: 'g@x.com', shipAddress: 'Manila',
  courier: 'J&T', packedBy: 'Nova', paymentMethod: 'BDO', totalUsd: '10.00', totalPhp: '560.00',
  items: [counterLine(3, 3)],
  ...o,
});

// Three vials joined in Kahati, two more sold by the Pasalo window that
// finished the batch.
const kahatiReport = () => buildWeeklyReport('2026-05-25', [
  order({ orderNo: 'a', createdAt: '2026-05-26T02:00:00Z', items: [counterLine(3, 3)] }),
  order({ orderNo: 'b', createdAt: '2026-05-27T02:00:00Z', items: [counterLine(2, 3)] }),
]);

const props = {
  isBusy: false,
  onDownload: vi.fn(),
  onPrintPackingList: vi.fn(),
};

describe('SegmentReport', () => {
  it('says the Kahati report includes Pasalo, and how much of it is Pasalo', () => {
    render(<SegmentReport segment="kahati" report={kahatiReport()} {...props} />);

    const split = screen.getByTestId('kahati-stage-split');
    expect(split).toHaveTextContent(/pasalo/i);
    expect(split).toHaveTextContent('3');
    expect(split).toHaveTextContent('2');
  });

  // The other two halves have no counters in them, so the line would be a row
  // of zeroes that reads as a bug rather than as an absence.
  it('does not put the stage split on a report that has no counters', () => {
    render(<SegmentReport segment="onhand" report={kahatiReport()} {...props} />);
    expect(screen.queryByTestId('kahati-stage-split')).not.toBeInTheDocument();
  });
});
