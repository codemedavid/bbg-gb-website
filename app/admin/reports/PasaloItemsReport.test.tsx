import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiGet } from '@/lib/api-client';
import { buildPasaloItems } from '@/lib/report/pasalo-items';
import { PasaloItemsReport } from './PasaloItemsReport';

vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), qs: (q: Record<string, string>) => `?${new URLSearchParams(q)}` }));
const cycle = { cycleKey: 'current', from: '2026-09-12', to: '2026-09-16', orderCount: 2, vials: 13 };
const items = buildPasaloItems([
  { id: 'one', name: 'Short product', status: 'open', claimedSlots: 5, totalSlots: 10, kahatiVials: null, code: 'A', spec: '10mg' },
  { id: 'two', name: 'Qualified product', status: 'closed', claimedSlots: 8, totalSlots: 10, kahatiVials: null, code: 'B', spec: '20mg' },
]);
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiGet).mockResolvedValue({ items }); });

it('shows product gaps and directs exports to the combined workbook', async () => {
  render(<PasaloItemsReport cycle={cycle} />, { wrapper });
  const short = (await screen.findByText('Short product')).closest('tr')!;
  expect(within(short).getByText('5/10')).toBeInTheDocument();
  expect(within(short).getByText('2')).toBeInTheDocument();
  expect(within(short).getByText('5')).toBeInTheDocument();
  expect(screen.getByText('Closed — review before offering')).toBeInTheDocument();
  expect(apiGet).toHaveBeenCalledWith('/admin/report/pasalo-items?cycleKey=current');
  expect(screen.getByText(/Download these details together/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
});

it('does not request an all-batches list when no batch is selected', () => {
  render(<PasaloItemsReport />, { wrapper });
  expect(apiGet).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
});

it('shows a load error instead of claiming there are no incomplete kits', async () => {
  vi.mocked(apiGet).mockRejectedValue(new Error('Offline'));
  render(<PasaloItemsReport cycle={cycle} />, { wrapper });
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
  expect(screen.queryByText('No incomplete kits in this batch.')).not.toBeInTheDocument();
});
