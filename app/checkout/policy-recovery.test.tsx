// Checkout when the Kahati deposit rule cannot be read.
//
// The screen refuses to quote a hatian order until it knows what the deposit
// policy is, and that refusal is right: guessing either way hides a payment card
// from a checkout the server charges for, or shows a proof box quoting no
// amount. See the comments around `awaitingDownpaymentPolicy` in page.tsx.
//
// What was wrong is what happens when the answer never arrives. The query is
// configured `retry: 1, refetchOnWindowFocus: false` (app/providers.tsx), so two
// failed attempts leave it in an error state permanently — and the page rendered
// "please wait a moment" with no spinner, no error and no way to ask again. The
// Place button never enabled. On a dropped mobile request the customer was stuck
// on a message that actively told them not to reload.
//
// Kahati is the dominant board, so this stranded the majority of checkouts that
// hit it. These tests hold the recovery path open: say a fetch failed, and offer
// a way to try again.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCart } from '@/lib/store/cart';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana Cruz', email: 'ana@example.com', phone: '09171234567', address: '123 Mabini St' },
    loading: false,
    status: 'authenticated',
  }),
}));

// The policy query's three reportable states, driven per test.
const policyQuery = {
  data: undefined as unknown,
  isSuccess: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
};

vi.mock('@/lib/queries', () => ({
  useKahatiDownpaymentPolicy: () => policyQuery,
  usePaymentMethods: () => ({ data: [{
    id: 'pm-full', label: 'GCash', accountName: 'BBG', accountNumber: '0917',
    qrUrl: null, purpose: 'full', instructions: null,
  }] }),
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300 } }),
  useKahatiCommitments: () => ({ data: undefined }),
  useCyclePackingFeePaid: () => ({ data: false }),
}));

const CheckoutPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const seedKahatiCart = () => useCart.setState({
  items: [{
    key: 'gb:k1', kind: 'group_buy', refId: 'k1', name: 'Reta 10mg — kahati',
    spec: 'Kahati · min 1 vial', unitPricePhp: 900, qty: 2, minQty: 1, packingFeePhp: 150,
  }],
});

beforeEach(() => {
  policyQuery.data = undefined;
  policyQuery.isSuccess = false;
  policyQuery.isError = false;
  policyQuery.isFetching = false;
  policyQuery.refetch = vi.fn();
  useCart.getState().clear();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
});

describe('checkout when the kahati deposit rule cannot be read', () => {
  it('says the details could not be loaded rather than asking the customer to keep waiting', async () => {
    // The distinction the old screen could not make: a request still in flight
    // and a request that has already given up both rendered "please wait".
    policyQuery.isError = true;
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load|could not load/i));
    expect(screen.queryByText(/please wait a moment/i)).not.toBeInTheDocument();
  });

  it('offers a way to ask again, since the query will not retry on its own', async () => {
    // `refetchOnWindowFocus: false` and an exhausted `retry` budget mean nothing
    // reissues this request. Without a button the only escape is a full reload,
    // which the waiting copy tells the customer not to do.
    policyQuery.isError = true;
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    const again = await screen.findByRole('button', { name: /try again/i });
    again.click();

    await waitFor(() => expect(policyQuery.refetch).toHaveBeenCalled());
  });

  it('still refuses to place the order while the rule is unknown', async () => {
    // The recovery path must not become an escape hatch: an order placed against
    // an unknown deposit rule is quoted at a figure the screen never showed.
    policyQuery.isError = true;
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const place = screen.getByRole('button', { name: /place order|upload proof|confirm order/i });
    expect(place).toBeDisabled();
  });

  it('shows the waiting notice only while the request is genuinely in flight', () => {
    // The first paint of a normal checkout. Nothing has failed, so nothing
    // should be reported as failed.
    policyQuery.isFetching = true;
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByText(/please wait a moment/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('lets an on-hand-only cart check out even when the kahati rule is unreadable', async () => {
    // Nothing in this cart has a deposit, so the deposit rule is irrelevant to
    // it. Blocking here would take ready stock down with a setting it never
    // consults — the same reasoning as the schedule gate in POST /api/orders.
    policyQuery.isError = true;
    useCart.setState({
      items: [{
        key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
        spec: '10mg', unitPricePhp: 550, qty: 2, minQty: 1, unit: 'piece', stock: 100,
      }],
    });

    render(<CheckoutPage />, { wrapper });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([Buffer.from('p')], 'proof.png', { type: 'image/png' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
  });
});
