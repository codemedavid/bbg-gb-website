import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import type { WeeklyReport } from '@/lib/report/build';
import { addDays, mostRecentFullWeekMonday } from '@/lib/report/week';
import { useToast } from '@/lib/store/toast';

// The page picks the week itself and defaults to the most recent full one, so
// that — not the mocked response — is the Monday it exports under.
const SELECTED_MONDAY = mostRecentFullWeekMonday(new Date());
// …and the end date the page defaults to, six days later. The filename carries
// both: "BBG-Week-<from>" on a workbook whose range was not a week is what let a
// one-week batch sheet be reconciled against months of counters.
const SELECTED_END = addDays(SELECTED_MONDAY, 6);

const half = (invoice: string, code: string, name: string, buyType: 'solo' | 'group_buy' | 'kahati'): WeeklyReport => ({
  weekNo: 21, rangeLabel: 'Mon May 25 – Sun May 31', orderCount: 1,
  counts: { paid: 1, pending: 0, cancelled: 0 }, totals: { usd: 100, php: 5000, packingFee: 300 },
  rows: [{
    index: 1, invoice, buyType, date: '5/25/2025', customer: 'Ana Reyes', contact: '',
    phone: '0917', email: 'a@x.com', address: 'QC', productCodes: [code], products: [`${name} x5`], courier: 'J&T',
    packedBy: 'Cza', payment: 'GCash', paymentStatus: 'Paid', orderStatus: 'Shipped', status: 'Shipped', isCancelled: false, usd: 100, php: 5000,
    packingFeePhp: 300,
  }],
  productTotals: {
    rows: [{ index: 1, name, code, spec: '30mg', usd: 100, qty: 5, kits: 0.5 }],
    totals: { usd: 100, qty: 5, kits: 0.5 },
  },
  buyerSummary: { groups: [], totals: { qty: 0, amountPhp: 0 } },
  kahatiStage: { kahatiVials: 0, pasaloVials: 0, totalVials: 0, counters: 0 },
});

const onhand = half('BBG-2500', 'TR15', 'Tirzepatide', 'solo');
const groupbuy = half('BBG-2600', 'TR30', 'Tirzepatide', 'group_buy');
const kahati = half('BBG-2700', 'RT30', 'Retatrutide', 'kahati');

const emptyHalf: WeeklyReport = {
  weekNo: 21, rangeLabel: 'Mon May 25 – Sun May 31', orderCount: 0,
  counts: { paid: 0, pending: 0, cancelled: 0 }, totals: { usd: 0, php: 0, packingFee: 0 },
  rows: [], productTotals: { rows: [], totals: { usd: 0, qty: 0, kits: 0 } },
  buyerSummary: { groups: [], totals: { qty: 0, amountPhp: 0 } },
  kahatiStage: { kahatiVials: 0, pasaloVials: 0, totalVials: 0, counters: 0 },
};

const segments = { onhand, groupbuy, kahati };

// The batch the Reports page offers as a preset, with the dates its own orders
// span — deliberately NOT a Mon-Sun week.
const BATCH = {
  cycleKey: '2026-08-29T14:00:00.000Z', from: '2026-08-30', to: '2026-09-04',
  orderCount: 87, vials: 542,
};

const respondTo = (path: string) => (path.startsWith('/admin/report/cycles')
  ? { cycles: [BATCH] }
  : { monday: '2025-05-25', report: onhand, segments });

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async (path: string) => respondTo(path)),
  qs: () => '?week=2025-05-25',
}));
vi.mock('@/lib/report/weekly-xlsx', () => ({ downloadWeeklyReportXlsx: vi.fn() }));

const { apiGet } = await import('@/lib/api-client');
const { downloadWeeklyReportXlsx } = await import('@/lib/report/weekly-xlsx');
const Page = (await import('./page')).default;

// The page now carries the Pasalo panel, whose Close control routes through the
// shared ConfirmProvider — the same one app/admin/layout.tsx mounts around every
// admin screen in production. Rendering the page without it throws, so the
// wrapper mirrors the real tree rather than the page in isolation.
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConfirmProvider>{children}</ConfirmProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.mocked(downloadWeeklyReportXlsx).mockClear();
  vi.mocked(apiGet).mockImplementation(async (path: string) => respondTo(path) as never);
});

describe('AdminReportsPage', () => {
  it('offers calendar controls for a custom date range', () => {
    render(<Page />, { wrapper });

    expect(screen.getByLabelText(/report start date/i)).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText(/report end date/i)).toHaveAttribute('type', 'date');
  });

  it('renders the Reports heading', async () => {
    render(<Page />, { wrapper });

    expect(screen.getByRole('heading', { name: /reports/i })).toBeInTheDocument();
    expect(await screen.findByText('BBG-2500')).toBeInTheDocument();
  });

  it('renders a section per half of the week', async () => {
    render(<Page />, { wrapper });

    expect(await screen.findByRole('heading', { name: /^on-hand$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^group buy$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^kahati$/i })).toBeInTheDocument();
  });

  it('keeps each half\'s orders and product totals inside its own section', async () => {
    // The whole point of the split: reading the group-buy section must never
    // show on-hand stock, because that section is what the batch order is
    // placed from.
    render(<Page />, { wrapper });

    const groupBuySection = await screen.findByRole('region', { name: /^group buy$/i });
    expect(within(groupBuySection).getByText('BBG-2600')).toBeInTheDocument();
    expect(within(groupBuySection).getAllByText('TR30').length).toBeGreaterThan(0);
    expect(within(groupBuySection).queryByText('BBG-2500')).not.toBeInTheDocument();
    expect(within(groupBuySection).queryByText('TR15')).not.toBeInTheDocument();

    const kahatiSection = screen.getByRole('region', { name: /^kahati$/i });
    expect(within(kahatiSection).getByText('BBG-2700')).toBeInTheDocument();
    expect(within(kahatiSection).queryByText('BBG-2600')).not.toBeInTheDocument();

    const onHandSection = screen.getByRole('region', { name: /^on-hand$/i });
    expect(within(onHandSection).getByText('BBG-2500')).toBeInTheDocument();
    expect(within(onHandSection).queryByText('BBG-2600')).not.toBeInTheDocument();
  });

  it('fills the range from a batch instead of making the admin type it', async () => {
    // A batch runs 22:00 to 22:00, so no calendar preset reproduces it. Typing
    // the dates is what swept one order of the next batch into a supplier
    // sheet for the previous one.
    const user = userEvent.setup();
    render(<Page />, { wrapper });

    // The picker renders before its batches land, so wait for the option itself.
    await screen.findByRole('option', { name: /^This batch/ });
    await user.selectOptions(screen.getByLabelText(/report batch/i), '2026-08-29T14:00:00.000Z');

    expect(screen.getByLabelText(/report start date/i)).toHaveValue('2026-08-30');
    expect(screen.getByLabelText(/report end date/i)).toHaveValue('2026-09-04');
  });

  it('names each batch by its dates and size so the right one is picked', async () => {
    render(<Page />, { wrapper });

    expect(await screen.findByRole('option', { name: 'This batch · Aug 30, 2026 – Sep 4, 2026 · 87 orders' }))
      .toBeInTheDocument();
  });

  it('states the covered dates in every section header', async () => {
    // The section says how many orders and products it holds; without the dates
    // beside them, the figures read as "the current state of the board" rather
    // than as one range.
    render(<Page />, { wrapper });

    const kahatiSection = await screen.findByRole('region', { name: /^kahati$/i });
    expect(within(kahatiSection).getByText('Mon May 25 – Sun May 31 · 1 order · 1 product')).toBeInTheDocument();
  });

  it('names the dates even in a section with no orders', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path.startsWith('/admin/report/cycles')
      ? { cycles: [BATCH] }
      : { monday: '2025-05-25', report: onhand, segments: { onhand, groupbuy: emptyHalf, kahati } }) as never);
    render(<Page />, { wrapper });

    const groupBuySection = await screen.findByRole('region', { name: /^group buy$/i });
    expect(within(groupBuySection).getByText('No orders in Mon May 25 – Sun May 31.')).toBeInTheDocument();
  });

  it('downloads each half as its own workbook, stamped with the range it covers', async () => {
    const user = userEvent.setup();
    render(<Page />, { wrapper });

    await user.click(await screen.findByRole('button', { name: /on-hand excel/i }));
    expect(downloadWeeklyReportXlsx).toHaveBeenCalledWith(onhand, SELECTED_MONDAY, 'onhand', SELECTED_END);

    await user.click(screen.getByRole('button', { name: /group buy excel/i }));
    expect(downloadWeeklyReportXlsx).toHaveBeenCalledWith(groupbuy, SELECTED_MONDAY, 'groupbuy', SELECTED_END);

    await user.click(screen.getByRole('button', { name: /kahati excel/i }));
    expect(downloadWeeklyReportXlsx).toHaveBeenCalledWith(kahati, SELECTED_MONDAY, 'kahati', SELECTED_END);
  });

  it('disables only the button for a half with no orders', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path.startsWith('/admin/report/cycles')
      ? { cycles: [BATCH] }
      : { monday: '2025-05-25', report: onhand, segments: { onhand, groupbuy: emptyHalf, kahati } }) as never);
    render(<Page />, { wrapper });

    expect(await screen.findByRole('button', { name: /on-hand excel/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /group buy excel/i })).toBeDisabled();
  });
});

// Packing day is worked from addresses, not from a spreadsheet. The button
// opens the printable list; the browser's print dialog is what saves the PDF.
describe('AdminReportsPage — packing list', () => {
  const fakeWindow = () => ({
    document: { write: vi.fn(), close: vi.fn(), readyState: 'complete' },
    print: vi.fn(),
    addEventListener: vi.fn(),
  });

  it('prints the segment addresses and order contents', async () => {
    const opened = fakeWindow();
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    const user = userEvent.setup();
    render(<Page />, { wrapper });

    const buttons = await screen.findAllByRole('button', { name: /packing list pdf/i });
    await user.click(buttons[0]);

    expect(open).toHaveBeenCalled();
    const html = String(opened.document.write.mock.calls[0][0]);
    expect(html).toContain('Ana Reyes');
    expect(html).toContain('BBG-2500');
    expect(opened.print).toHaveBeenCalled();
    open.mockRestore();
  });

  // A blocked pop-up is the common failure, and a button that silently does
  // nothing leaves the admin with no idea why no sheet appeared. The toast
  // itself is rendered by the admin layout, so this asserts on the store the
  // page publishes to rather than on markup this render does not own.
  it('explains itself when the browser blocks the print window', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const shown: string[] = [];
    const showToast = vi.spyOn(useToast.getState(), 'show')
      .mockImplementation((message: string) => { shown.push(message); });
    const user = userEvent.setup();
    render(<Page />, { wrapper });

    const buttons = await screen.findAllByRole('button', { name: /packing list pdf/i });
    await user.click(buttons[0]);

    expect(shown.join(' ')).toMatch(/blocked the print window/i);
    open.mockRestore();
    showToast.mockRestore();
  });
});
