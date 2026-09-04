// Checkout when the app is unsure who the customer is.
//
// Two bugs met on this line:
//
//   useEffect(() => { if (!loading && !user) router.replace('/login'); }, ...)
//
// `user` was null for a dropped /auth/me request as readily as for a real
// logout (see lib/useAuth.test.tsx), so a blip ejected a signed-in customer
// from a checkout they had already filled in. And the bounce named no return
// path, even though the login screen has supported `?next=` since the order
// emails needed it (lib/return-path.ts) — so the ones who WERE genuinely signed
// out came back to the home page and had to find the cart, the address and the
// proof screenshots all over again.
//
// A checkout is the most expensive screen in the app to lose. These hold both
// halves: only a settled "signed out" redirects, and it comes back here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCart } from '@/lib/store/cart';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

// The auth state under test, swapped per case.
const auth = {
  current: { user: null as unknown, loading: false, status: 'unauthenticated' as string },
};
vi.mock('@/lib/useAuth', () => ({ useAuth: () => auth.current }));

vi.mock('@/lib/queries', () => ({
  useKahatiDownpaymentPolicy: () => ({ data: undefined, isSuccess: true, isError: false, isFetching: false, refetch: vi.fn() }),
  usePaymentMethods: () => ({ data: [] }),
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

const USER = {
  id: 'u1', name: 'Ana Cruz', email: 'ana@example.com',
  phone: '09171234567', address: '123 Mabini St',
};

beforeEach(() => {
  replace.mockReset();
  useCart.getState().clear();
  useCart.setState({
    items: [{
      key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
      spec: '10mg', unitPricePhp: 550, qty: 2, minQty: 1, unit: 'piece', stock: 100,
    }],
  });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
});

describe('checkout session handling', () => {
  it('sends a genuinely signed-out visitor to log in', async () => {
    auth.current = { user: null, loading: false, status: 'unauthenticated' };

    render(<CheckoutPage />, { wrapper });

    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it('brings them back to checkout afterwards instead of the home page', async () => {
    // They have a cart, an address typed in and screenshots ready. Landing on
    // the storefront makes them rebuild all of it.
    auth.current = { user: null, loading: false, status: 'unauthenticated' };

    render(<CheckoutPage />, { wrapper });

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fcheckout'));
  });

  it('does not eject a customer whose session simply could not be confirmed', async () => {
    // `unknown` is a failed /auth/me, not a logout. The cookie is still in the
    // browser and the checkout POST will be accepted; throwing them out here
    // costs a sale to a network blip.
    auth.current = { user: null, loading: false, status: 'unknown' };

    render(<CheckoutPage />, { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not redirect while the session is still resolving', async () => {
    auth.current = { user: null, loading: true, status: 'loading' };

    render(<CheckoutPage />, { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves a signed-in customer where they are', async () => {
    auth.current = { user: USER, loading: false, status: 'authenticated' };

    render(<CheckoutPage />, { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(replace).not.toHaveBeenCalled();
  });
});
