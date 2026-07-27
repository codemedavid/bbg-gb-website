// Cart page — the back button must lead somewhere, not into a loop.
//
// Checkout's back button goes to the cart. The cart's back button used to fall
// through to router.back(), which walked straight back into checkout: two
// screens pointing at each other with no way out but the bottom nav.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCart } from '@/lib/store/cart';

const push = vi.fn();
const back = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back, replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/queries', () => ({
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300 } }),
  useKahatiDownpayment: () => ({ data: 150 }),
  useKahatiCommitments: () => ({ data: undefined }),
  useMoqPageEnabled: () => ({ data: false }),
}));

const CartPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  push.mockReset();
  back.mockReset();
  useCart.setState({
    items: [{
      key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
      spec: '10mg', unitPricePhp: 550, qty: 1, minQty: 1, unit: 'piece', stock: 100,
    }],
  });
});

describe('CartPage back button', () => {
  it('leaves for the storefront rather than circling back into checkout', () => {
    render(<CartPage />, { wrapper });

    screen.getByRole('button', { name: /go back/i }).click();

    expect(push).toHaveBeenCalledWith('/');
    // router.back() is what produced the loop: checkout -> cart -> checkout.
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalledWith('/checkout');
  });

  it('still sends the customer forward to checkout', () => {
    render(<CartPage />, { wrapper });

    screen.getByRole('button', { name: /proceed to checkout/i }).click();

    expect(push).toHaveBeenCalledWith('/checkout');
  });
});
