/**
 * @vitest-environment jsdom
 */
// The Orders-page shortcut to the weekly export.
//
// It downloads the same workbooks the Reports page does, and it was the one
// surface still shipping a single combined file — on-hand sales mixed into the
// kit counts the batch order is placed from.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WeeklyReport } from '@/lib/report/build';
import { mostRecentFullWeekMonday } from '@/lib/report/week';

const SELECTED_MONDAY = mostRecentFullWeekMonday(new Date());

const half = (invoice: string): WeeklyReport => ({
  weekNo: 21, rangeLabel: 'Mon May 25 – Sun May 31', orderCount: 1,
  counts: { paid: 1, pending: 0, cancelled: 0 }, totals: { usd: 100, php: 5000 },
  rows: [{
    index: 1, invoice, date: '5/25/2025', customer: 'Ana', contact: '', phone: '0917',
    email: 'a@x.com', address: 'QC', products: ['Reta x5'], courier: 'J&T', packedBy: 'Cza',
    payment: 'GCash', paymentStatus: 'Paid', orderStatus: 'Shipped', status: 'Shipped', usd: 100, php: 5000,
  }],
  productTotals: { rows: [], totals: { usd: 0, qty: 0 } },
});

const emptyHalf: WeeklyReport = {
  weekNo: 21, rangeLabel: 'Mon May 25 – Sun May 31', orderCount: 0,
  counts: { paid: 0, pending: 0, cancelled: 0 }, totals: { usd: 0, php: 0 },
  rows: [], productTotals: { rows: [], totals: { usd: 0, qty: 0 } },
};

const onhand = half('BBG-2500');
const groupbuy = half('BBG-2600');

const toasts: string[] = [];

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async () => ({ monday: SELECTED_MONDAY, segments: { onhand, groupbuy } })),
  qs: () => `?week=${SELECTED_MONDAY}`,
}));
vi.mock('@/lib/store/toast', () => ({
  useToast: (select: (s: { show: (m: string) => void }) => unknown) =>
    select({ show: (m: string) => { toasts.push(m); } }),
}));
vi.mock('@/lib/report/weekly-xlsx', () => ({ downloadWeeklyReportXlsx: vi.fn() }));

const { apiGet } = await import('@/lib/api-client');
const { downloadWeeklyReportXlsx } = await import('@/lib/report/weekly-xlsx');
const { WeeklyReportButton } = await import('./WeeklyReportButton');

beforeEach(() => {
  toasts.length = 0;
  vi.mocked(downloadWeeklyReportXlsx).mockClear();
  vi.mocked(apiGet).mockResolvedValue({ monday: SELECTED_MONDAY, segments: { onhand, groupbuy } });
});

describe('WeeklyReportButton', () => {
  it('offers a download per half of the week', () => {
    render(<WeeklyReportButton />);

    expect(screen.getByRole('button', { name: /on-hand/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /group buy/i })).toBeInTheDocument();
  });

  it('downloads the on-hand half under its own segment', async () => {
    const user = userEvent.setup();
    render(<WeeklyReportButton />);

    await user.click(screen.getByRole('button', { name: /on-hand/i }));

    expect(downloadWeeklyReportXlsx).toHaveBeenCalledWith(onhand, SELECTED_MONDAY, 'onhand');
  });

  it('downloads the group-buy half under its own segment', async () => {
    const user = userEvent.setup();
    render(<WeeklyReportButton />);

    await user.click(screen.getByRole('button', { name: /group buy/i }));

    expect(downloadWeeklyReportXlsx).toHaveBeenCalledWith(groupbuy, SELECTED_MONDAY, 'groupbuy');
  });

  it('says which half was empty instead of downloading a blank workbook', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      monday: SELECTED_MONDAY, segments: { onhand, groupbuy: emptyHalf },
    });
    const user = userEvent.setup();
    render(<WeeklyReportButton />);

    await user.click(screen.getByRole('button', { name: /group buy/i }));

    expect(downloadWeeklyReportXlsx).not.toHaveBeenCalled();
    expect(toasts.join(' ')).toMatch(/group buy/i);
  });

  it('surfaces a failed fetch as a toast rather than failing silently', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('Network down'));
    const user = userEvent.setup();
    render(<WeeklyReportButton />);

    await user.click(screen.getByRole('button', { name: /on-hand/i }));

    expect(toasts).toContain('Network down');
  });
});
