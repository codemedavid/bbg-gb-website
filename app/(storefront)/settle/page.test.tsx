// Hatian final checkout page.
//
// This is where the packing fee is finally charged — once, for every completed
// hatian the customer joined. The page has to make that visible, or a customer
// who committed to four batches cannot tell they were billed one fee and not four.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const replace = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Ana Cruz', email: 'ana@example.com' }, loading: false }),
}));

const preview = {
  current: {
    orders: [
      { id: 'o1', orderNo: 'BBG-2418', totalPhp: 2700, downpaymentPhp: 150, packingFeePhp: 0, hatianNames: ['Reta 10mg'], packingFee: 'unpaid', createdAt: new Date('2026-07-01').toISOString() },
      { id: 'o2', orderNo: 'BBG-2419', totalPhp: 1800, downpaymentPhp: 150, packingFeePhp: 0, hatianNames: ['Sema 5mg'], packingFee: 'unpaid', createdAt: new Date('2026-07-05').toISOString() },
    ],
    totals: { balancePhp: 4200, packingFeePhp: 150, totalPhp: 4350 },
  } as { orders: unknown[]; totals: { balancePhp: number; packingFeePhp: number; totalPhp: number } },
};

const methods = {
  current: [{ id: 'pm1', label: 'GCash', accountName: 'BBG', accountNumber: '0917', qrUrl: null }] as unknown[],
};
vi.mock('@/lib/queries', () => ({
  usePaymentMethods: () => ({ data: methods.current }),
  useSettlementPreview: () => ({ data: preview.current, isLoading: false }),
}));

const SettlePage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  methods.current = [{ id: 'pm1', label: 'GCash', accountName: 'BBG', accountNumber: '0917', qrUrl: null }];
  preview.current = {
    orders: [
      { id: 'o1', orderNo: 'BBG-2418', totalPhp: 2700, downpaymentPhp: 150, packingFeePhp: 0, hatianNames: ['Reta 10mg'], packingFee: 'unpaid', createdAt: new Date('2026-07-01').toISOString() },
      { id: 'o2', orderNo: 'BBG-2419', totalPhp: 1800, downpaymentPhp: 150, packingFeePhp: 0, hatianNames: ['Sema 5mg'], packingFee: 'unpaid', createdAt: new Date('2026-07-05').toISOString() },
    ],
    totals: { balancePhp: 4200, packingFeePhp: 150, totalPhp: 4350 },
  };
});

describe('hatian final checkout', () => {
  it('lists every completed hatian order waiting to be settled', async () => {
    render(<SettlePage />, { wrapper });
    expect(await screen.findByText(/BBG-2418/)).toBeInTheDocument();
    expect(screen.getByText(/BBG-2419/)).toBeInTheDocument();
  });

  it('shows a single packing fee line for the whole checkout', async () => {
    render(<SettlePage />, { wrapper });
    const feeLines = await screen.findAllByText(/packing fee/i);
    // One fee row in the summary — not one per settled order.
    const amounts = screen.getAllByText('₱150');
    expect(feeLines.length).toBeGreaterThan(0);
    expect(amounts.length).toBe(1);
  });

  it('totals the balances plus that one fee', async () => {
    render(<SettlePage />, { wrapper });
    expect(await screen.findByText('₱4,350')).toBeInTheDocument();
  });

  it('tells the customer there is nothing to settle when no hatian has completed', async () => {
    preview.current = { orders: [], totals: { balancePhp: 0, packingFeePhp: 0, totalPhp: 0 } };
    render(<SettlePage />, { wrapper });
    const empty = await screen.findByTestId('settle-empty');
    expect(empty).toBeInTheDocument();
    // The copy shipped as "Wala pang nothing to settle" — a half-merged Tagalog
    // and English string that every customer with no balance would have read.
    expect(empty.textContent).not.toMatch(/wala pang nothing/i);
  });

  it('keeps the pay button disabled until a proof of payment is attached', async () => {
    render(<SettlePage />, { wrapper });
    const button = await screen.findByRole('button', { name: /upload proof|pay/i });
    expect(button).toBeDisabled();
  });

  it('cannot be paid when no payment method exists to pay into', async () => {
    // The page says "no payment methods available, please contact us" — letting
    // the customer submit anyway would claim all their ready orders and mark them
    // awaiting review though no money could have moved.
    methods.current = [];
    render(<SettlePage />, { wrapper });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([Buffer.from('proof')], 'proof.png', { type: 'image/png' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const button = await screen.findByRole('button', { name: /pay|upload proof|contact/i });
    await waitFor(() => expect(button).toBeDisabled());
  });

  it('sends the final payment and returns the customer to their orders', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { settlement: { id: 's1' } } }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    render(<SettlePage />, { wrapper });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([Buffer.from('proof')], 'proof.png', { type: 'image/png' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const button = await screen.findByRole('button', { name: /pay/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    button.click();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('/api/settlements');
    expect(init.method).toBe('POST');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/orders'));
  });
});
