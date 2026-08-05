import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { WeeklyReport } from '@/lib/report/build';
import { mostRecentFullWeekMonday } from '@/lib/report/week';

// The page picks the week itself and defaults to the most recent full one, so
// that — not the mocked response — is the Monday it exports under.
const SELECTED_MONDAY = mostRecentFullWeekMonday(new Date());

const half = (invoice: string, code: string, name: string): WeeklyReport => ({
  weekNo: 21, rangeLabel: 'Mon May 25 – Sun May 31', orderCount: 1,
  counts: { paid: 1, pending: 0, cancelled: 0 }, totals: { usd: 100, php: 5000 },
  rows: [{
    index: 1, invoice, date: '5/25/2025', customer: 'Ana Reyes', contact: '',
    phone: '0917', email: 'a@x.com', address: 'QC', products: [`${name} x5`], courier: 'J&T',
    packedBy: 'Cza', payment: 'GCash', paymentStatus: 'Paid', orderStatus: 'Shipped', status: 'Shipped', usd: 100, php: 5000,
  }],
  productTotals: {
    rows: [{ index: 1, name, code, spec: '30mg', usd: 100, qty: 5, kits: 0.5 }],
    totals: { usd: 100, qty: 5 },
  },
});

const onhand = half('BBG-2500', 'TR15', 'Tirzepatide');
const groupbuy = half('BBG-2600', 'RT30', 'Retatrutide');

const emptyHalf: WeeklyReport = {
  weekNo: 21, rangeLabel: 'Mon May 25 – Sun May 31', orderCount: 0,
  counts: { paid: 0, pending: 0, cancelled: 0 }, totals: { usd: 0, php: 0 },
  rows: [], productTotals: { rows: [], totals: { usd: 0, qty: 0 } },
};

const segments = { onhand, groupbuy };

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async () => ({ monday: '2025-05-25', report: onhand, segments })),
  qs: () => '?week=2025-05-25',
}));
vi.mock('@/lib/report/weekly-xlsx', () => ({ downloadWeeklyReportXlsx: vi.fn() }));

const { apiGet } = await import('@/lib/api-client');
const { downloadWeeklyReportXlsx } = await import('@/lib/report/weekly-xlsx');
const Page = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  vi.mocked(downloadWeeklyReportXlsx).mockClear();
  vi.mocked(apiGet).mockResolvedValue({ monday: '2025-05-25', report: onhand, segments });
});

describe('AdminReportsPage', () => {
  it('renders the Reports heading', async () => {
    render(<Page />, { wrapper });

    expect(screen.getByRole('heading', { name: /reports/i })).toBeInTheDocument();
    expect(await screen.findByText('BBG-2500')).toBeInTheDocument();
  });

  it('renders a section per half of the week', async () => {
    render(<Page />, { wrapper });

    expect(await screen.findByRole('heading', { name: /^on-hand$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /group buy \/ kahati/i })).toBeInTheDocument();
  });

  it('keeps each half\'s orders and product totals inside its own section', async () => {
    // The whole point of the split: reading the group-buy section must never
    // show on-hand stock, because that section is what the batch order is
    // placed from.
    render(<Page />, { wrapper });

    const groupBuySection = await screen.findByRole('region', { name: /group buy \/ kahati/i });
    expect(within(groupBuySection).getByText('BBG-2600')).toBeInTheDocument();
    expect(within(groupBuySection).getByText('RT30')).toBeInTheDocument();
    expect(within(groupBuySection).queryByText('BBG-2500')).not.toBeInTheDocument();
    expect(within(groupBuySection).queryByText('TR15')).not.toBeInTheDocument();

    const onHandSection = screen.getByRole('region', { name: /^on-hand$/i });
    expect(within(onHandSection).getByText('BBG-2500')).toBeInTheDocument();
    expect(within(onHandSection).queryByText('BBG-2600')).not.toBeInTheDocument();
  });

  it('downloads each half as its own workbook', async () => {
    const user = userEvent.setup();
    render(<Page />, { wrapper });

    await user.click(await screen.findByRole('button', { name: /on-hand excel/i }));
    expect(downloadWeeklyReportXlsx).toHaveBeenCalledWith(onhand, SELECTED_MONDAY, 'onhand');

    await user.click(screen.getByRole('button', { name: /group buy excel/i }));
    expect(downloadWeeklyReportXlsx).toHaveBeenCalledWith(groupbuy, SELECTED_MONDAY, 'groupbuy');
  });

  it('disables only the button for a half with no orders', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      monday: '2025-05-25', report: onhand, segments: { onhand, groupbuy: emptyHalf },
    });
    render(<Page />, { wrapper });

    expect(await screen.findByRole('button', { name: /on-hand excel/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /group buy excel/i })).toBeDisabled();
  });
});
