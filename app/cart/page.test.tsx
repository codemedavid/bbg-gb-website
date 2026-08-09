// Cart page — the back button must lead somewhere, not into a loop.
//
// Checkout's back button goes to the cart. The cart's back button used to fall
// through to router.back(), which walked straight back into checkout: two
// screens pointing at each other with no way out but the bottom nav.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  useCampaignPackingFeeWaivers: () => ({ data: undefined }),
  useCyclePackingFeePaid: () => ({ data: false }),
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

const kahatiLine = {
  key: 'gb:g1', kind: 'group_buy' as const, refId: 'g1', name: 'Retatrutide 20mg — kahati',
  spec: 'Kahati · min 1 vials', unitPricePhp: 900, qty: 2, minQty: 1,
};
const campaignLine = {
  key: 'gbuy:c1', kind: 'moq_campaign' as const, refId: 'c1', name: 'Tirzepatide 30mg — group buy',
  spec: 'Group buy · batch #1', unitPricePhp: 10000, qty: 1, minQty: 1,
};

describe('CartPage — Group Buy and Kahati separation', () => {
  it('keeps items added from both boards, rather than sending either straight to payment', () => {
    // The requirement in full: browse Group Buy, add; browse Kahati, add; open
    // the cart; both are still there waiting to be reviewed.
    useCart.setState({ items: [campaignLine, kahatiLine] });
    render(<CartPage />, { wrapper });

    expect(screen.getByText('Tirzepatide 30mg — group buy')).toBeInTheDocument();
    expect(screen.getByText('Retatrutide 20mg — kahati')).toBeInTheDocument();
  });

  it('labels which items belong to Group Buy and which to Kahati', () => {
    useCart.setState({ items: [campaignLine, kahatiLine] });
    render(<CartPage />, { wrapper });

    expect(screen.getByRole('heading', { name: 'Group Buy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kahati' })).toBeInTheDocument();
  });

  it('files each line under its own system', () => {
    useCart.setState({ items: [campaignLine, kahatiLine] });
    render(<CartPage />, { wrapper });

    const kahatiSection = screen.getByRole('heading', { name: 'Kahati' }).closest('section')!;
    const groupBuySection = screen.getByRole('heading', { name: 'Group Buy' }).closest('section')!;

    expect(within(kahatiSection).getByText('Retatrutide 20mg — kahati')).toBeInTheDocument();
    expect(within(kahatiSection).queryByText('Tirzepatide 30mg — group buy')).not.toBeInTheDocument();
    expect(within(groupBuySection).getByText('Tirzepatide 30mg — group buy')).toBeInTheDocument();
  });

  it('warns that the two will become separately tracked orders', () => {
    useCart.setState({ items: [campaignLine, kahatiLine] });
    render(<CartPage />, { wrapper });

    expect(screen.getByText(/tracked separately/i)).toBeInTheDocument();
  });

  it('shows no split warning when the cart holds a single system', () => {
    useCart.setState({ items: [kahatiLine] });
    render(<CartPage />, { wrapper });

    expect(screen.queryByText(/tracked separately/i)).not.toBeInTheDocument();
  });

  it('lets a line be removed outright without stepping the quantity down', async () => {
    useCart.setState({ items: [kahatiLine] });
    render(<CartPage />, { wrapper });

    await userEvent.click(screen.getByRole('button', { name: /remove retatrutide 20mg — kahati from cart/i }));

    expect(useCart.getState().items).toEqual([]);
  });
});

describe('CartPage — order note', () => {
  beforeEach(() => {
    useCart.setState({ items: [kahatiLine], note: '' });
  });

  it('offers a note field before checkout', () => {
    render(<CartPage />, { wrapper });

    expect(screen.getByLabelText(/add a note to your order/i)).toBeInTheDocument();
  });

  it('keeps what the customer typed on the cart', async () => {
    render(<CartPage />, { wrapper });

    await userEvent.type(screen.getByLabelText(/add a note to your order/i), 'Text before delivery');

    expect(useCart.getState().note).toBe('Text before delivery');
  });

  it('shows a note the customer typed earlier when they come back', () => {
    useCart.setState({ items: [kahatiLine], note: 'Leave with the guard.' });
    render(<CartPage />, { wrapper });

    expect(screen.getByLabelText(/add a note to your order/i)).toHaveValue('Leave with the guard.');
  });

  it('does not change quantities or the price', async () => {
    render(<CartPage />, { wrapper });
    const before = useCart.getState().subtotal();

    await userEvent.type(screen.getByLabelText(/add a note to your order/i), 'Rush');

    expect(useCart.getState().subtotal()).toBe(before);
    expect(useCart.getState().items[0].qty).toBe(2);
  });

  it('hides the note field on an empty cart, since there is no order to annotate', () => {
    useCart.setState({ items: [], note: '' });
    render(<CartPage />, { wrapper });

    expect(screen.queryByLabelText(/add a note to your order/i)).not.toBeInTheDocument();
  });
});
