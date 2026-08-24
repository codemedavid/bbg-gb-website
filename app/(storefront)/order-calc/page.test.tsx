// The order calculator end to end — search, add, step, total.
//
// The pieces are unit-tested apart; what only this page can prove is that they
// are wired to each other and to the real fee table: that adding a product from
// the search list reaches the total, and that the fee follows the fulfilment
// mode rather than being a constant somebody typed once.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/order-calc',
}));

const products = [
  { id: 'a', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial', pricePhp: '695.5', onHandPiecePhp: '695.5', onHandKitPhp: null, stock: 40 },
  { id: 'b', code: 'BC10', name: 'BPC-157', spec: '10 mg/vial', pricePhp: '500', onHandPiecePhp: '500', onHandKitPhp: null, stock: 4 },
];

vi.mock('@/lib/queries', () => ({
  // undefined -> useOrderTotals falls back to the default (packing-fee) policy,
  // which is the behaviour these tests were written against.
  useKahatiDownpaymentPolicy: () => ({ data: undefined, isSuccess: true }),
  useProducts: () => ({ data: products, isLoading: false }),
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300, moq: 200 } }),
  useMoqPageEnabled: () => ({ data: false }),
}));

const OrderCalcPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const setup = () => render(<OrderCalcPage />, { wrapper });

// Type a code, then tap the row it narrows to.
const addByCode = async (code: string, name: RegExp) => {
  const search = screen.getByLabelText('Search products');
  await userEvent.clear(search);
  await userEvent.type(search, code);
  await userEvent.click(screen.getByRole('button', { name }));
};

beforeEach(() => vi.clearAllMocks());

describe('Order calculator page', () => {
  it('starts empty, owing nothing', () => {
    setup();
    expect(screen.getByText(/no products yet/i)).toBeInTheDocument();
    expect(screen.getByText('₱0')).toBeInTheDocument();
  });

  it('carries a product from the search list into the order', async () => {
    setup();
    await addByCode('BC10', /add bpc-157/i);
    expect(screen.getByRole('button', { name: /increase bpc-157/i })).toBeInTheDocument();
  });

  // ₱500 of goods + the ₱200 on-hand packing fee. The fee is the storefront's
  // real solo rate, not a number invented for the calculator.
  it('totals the goods plus the on-hand packing fee', async () => {
    setup();
    await addByCode('BC10', /add bpc-157/i);
    expect(screen.getByText('₱700')).toBeInTheDocument();
  });

  it('re-totals when the quantity is stepped up', async () => {
    setup();
    await addByCode('BC10', /add bpc-157/i);
    await userEvent.click(screen.getByRole('button', { name: /increase bpc-157/i }));
    expect(screen.getByText('₱1,200')).toBeInTheDocument();
  });

  it('adds the same product twice as one line, not two', async () => {
    setup();
    await addByCode('BC10', /add bpc-157/i);
    await addByCode('BC10', /add bpc-157/i);
    expect(screen.getByText('2 vials')).toBeInTheDocument();
  });

  it('drops the line when it is stepped down to nothing', async () => {
    setup();
    await addByCode('BC10', /add bpc-157/i);
    await userEvent.click(screen.getByRole('button', { name: /decrease bpc-157/i }));
    expect(screen.getByText(/no products yet/i)).toBeInTheDocument();
  });

  // The whole reason the mode selector exists: ₱500 of goods is a ₱650 hatian
  // order and an ₱800 pasabay one, and quoting one rate for both is wrong twice.
  it('re-prices the fee when the fulfilment mode changes', async () => {
    setup();
    await addByCode('BC10', /add bpc-157/i);
    await userEvent.click(screen.getByRole('button', { name: /estimated total/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Hatian' }));
    expect(screen.getByText('₱650')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pasabay' }));
    expect(screen.getByText('₱800')).toBeInTheDocument();
  });

  it('quotes the catalogue even for a product that is not in stock', async () => {
    setup();
    await addByCode('TR15', /add tirzepatide/i);
    expect(screen.getByText('₱895.50')).toBeInTheDocument();
  });
});
