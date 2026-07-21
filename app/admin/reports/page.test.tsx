import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { WeeklyReport } from '@/lib/report/build';

const report: WeeklyReport = {
  weekNo: 21, rangeLabel: 'Mon May 25 – Sun May 31', orderCount: 1,
  counts: { paid: 1, pending: 0, cancelled: 0 }, totals: { usd: 100, php: 5000 },
  rows: [{
    index: 1, invoice: 'BBG-2500', date: '5/25/2025', customer: 'Ana Reyes', contact: '',
    phone: '0917', email: 'a@x.com', address: 'QC', products: ['Reta x5'], courier: 'J&T',
    packedBy: 'Cza', payment: 'GCash', paymentStatus: 'Paid', orderStatus: 'Shipped', status: 'Shipped', usd: 100, php: 5000,
  }],
};

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async () => ({ monday: '2025-05-25', report })),
  qs: () => '?week=2025-05-25',
}));
vi.mock('@/lib/report/weekly-xlsx', () => ({ downloadWeeklyReportXlsx: vi.fn() }));

const Page = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('AdminReportsPage', () => {
  it('renders the Reports heading and the fetched Order Summary', async () => {
    render(<Page />, { wrapper });

    expect(screen.getByRole('heading', { name: /reports/i })).toBeInTheDocument();
    expect(await screen.findByText('BBG-2500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /weekly excel/i })).toBeInTheDocument();
  });
});
