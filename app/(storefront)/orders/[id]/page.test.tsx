// The order details page — the whole order on one screen.
//
// The brief's complaint is that a customer had to walk several unrelated
// screens to reconstruct their own order, and for a large order could not
// reconstruct it at all. So these tests assert the six blocks the brief names
// are all present at once, on an order big enough to have been the problem.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const push = vi.fn();
const back = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back, replace: vi.fn(), prefetch: vi.fn() }),
}));

const state = { detail: undefined as unknown, isLoading: false };
vi.mock('@/lib/queries', () => ({
  useOrderDetail: () => ({ data: state.detail, isLoading: state.isLoading }),
}));

const OrderDetailPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const items = [
  { id: 'a', kind: 'product', nameSnapshot: 'Tirzepatide 15mg vial', specSnapshot: 'On-hand · per piece', unitPricePhp: '3200', qty: 1, lineTotalPhp: '3200' },
  { id: 'b', kind: 'product', nameSnapshot: 'Tirzepatide 30mg vial', specSnapshot: 'On-hand · per piece', unitPricePhp: '4850', qty: 1, lineTotalPhp: '4850' },
  { id: 'c', kind: 'product', nameSnapshot: 'Retatrutide 20mg vial', specSnapshot: 'On-hand · per piece', unitPricePhp: '6875', qty: 2, lineTotalPhp: '13750' },
  { id: 'd', kind: 'product', nameSnapshot: 'Cagrilintide 5mg vial', specSnapshot: 'On-hand · per piece', unitPricePhp: '4050', qty: 3, lineTotalPhp: '12150' },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `x${i}`, kind: 'product', nameSnapshot: `Peptide ${i}`, specSnapshot: 'On-hand · per piece',
    unitPricePhp: '1000', qty: 1, lineTotalPhp: '1000',
  })),
];

const detail = {
  order: {
    id: 'o9', orderNo: 'BBG-2419', status: 'shipped', buyType: 'solo',
    subtotalPhp: '41950', packingFeePhp: '200', totalPhp: '42150', downpaymentPhp: '0',
    shipName: 'Ana Cruz', shipPhone: '09171234567', shipAddress: '123 Mabini St, Manila',
    trackingNo: 'JT-99118822', courier: 'J&T', paymentMethod: 'GCash',
    settlementStatus: null, notes: 'Please text before delivery.',
    createdAt: new Date('2026-07-01T09:00:00Z').toISOString(),
  },
  customer: { name: 'Ana Cruz', email: 'ana@example.com', phone: '09171234567' },
  items,
  history: [],
  proofUrl: 'https://example.test/proof.png',
};

beforeEach(() => {
  push.mockReset();
  back.mockReset();
  state.detail = detail;
  state.isLoading = false;
});

describe('order information', () => {
  it('names the order and its status', () => {
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    expect(screen.getByText('BBG-2419')).toBeInTheDocument();
    expect(screen.getAllByText('Shipped').length).toBeGreaterThan(0);
  });
});

describe('customer information', () => {
  it('shows the name, contact number and email', () => {
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    const block = screen.getByTestId('customer-block');
    expect(block).toHaveTextContent('Ana Cruz');
    expect(block).toHaveTextContent('09171234567');
    expect(block).toHaveTextContent('ana@example.com');
  });
});

describe('shipping information', () => {
  it('shows the full address, the courier and the tracking number', () => {
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    const block = screen.getByTestId('shipping-block');
    expect(block).toHaveTextContent('123 Mabini St, Manila');
    expect(block).toHaveTextContent('J&T');
    expect(block).toHaveTextContent('JT-99118822');
  });

  it('says so plainly when there is no tracking number yet', () => {
    state.detail = { ...detail, order: { ...detail.order, trackingNo: null } };
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    expect(screen.getByTestId('shipping-block')).toHaveTextContent(/not yet assigned|no tracking/i);
  });
});

describe('ordered items', () => {
  it('lists every line of a twelve-item order', () => {
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    expect(screen.getAllByRole('listitem')).toHaveLength(12);
  });

  it('shows quantity, unit price and line total per item', () => {
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    const row = screen.getAllByRole('listitem').find((r) => r.textContent?.includes('Retatrutide'))!;
    expect(row).toHaveTextContent('Qty: 2');
    expect(row).toHaveTextContent('₱6,875');
    expect(row).toHaveTextContent('₱13,750');
  });
});

describe('payment', () => {
  it('shows the method, the amount and a link to the proof', () => {
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    const block = screen.getByTestId('payment-block');
    expect(block).toHaveTextContent('GCash');
    expect(block).toHaveTextContent('₱42,150');
    expect(within(block).getByRole('link', { name: /proof/i }))
      .toHaveAttribute('href', 'https://example.test/proof.png');
  });

  it('omits the proof link entirely when none was uploaded', () => {
    state.detail = { ...detail, proofUrl: null };
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    expect(within(screen.getByTestId('payment-block')).queryByRole('link')).toBeNull();
  });
});

describe('order summary', () => {
  it('breaks the charge down to a grand total', () => {
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    const block = screen.getByTestId('summary-block');
    expect(block).toHaveTextContent('₱41,950');  // subtotal
    expect(block).toHaveTextContent('₱200');     // packing fee
    expect(block).toHaveTextContent('₱42,150');  // grand total
  });
});

// A dead-end details page sends the customer to the browser's back button, and
// on a fresh tab that goes nowhere at all.
describe('getting back out', () => {
  it('offers a route back to the order list', async () => {
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });

    (await screen.findByRole('button', { name: /go back/i })).click();
    expect(push).toHaveBeenCalledWith('/orders');
  });
});
