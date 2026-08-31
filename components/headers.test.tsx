// BackHeader — the Checkout page's only navigation. Checkout sits outside the
// bottom nav, so without an explicit Home link the page is a dead end.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from '@/lib/types';

const back = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back, push, replace: vi.fn(), prefetch: vi.fn() }),
}));
// AuthControl (used by the other headers) pulls in the auth context; BackHeader
// does not, so a minimal stub keeps this file focused on navigation.
let auth: { user: User | null; loading: boolean } = { user: null, loading: false };
vi.mock('@/lib/useAuth', () => ({ useAuth: () => auth }));

const { BackHeader, SectionHeader, AppHeader } = await import('./headers');

const signedIn = { id: 'u1', name: 'Yna', email: 'yna@example.com', role: 'customer' } as unknown as User;

beforeEach(() => {
  auth = { user: null, loading: false };
});

describe('BackHeader', () => {
  it('shows no Home link by default', () => {
    render(<BackHeader title="Cart · 2" />);

    expect(screen.queryByRole('link', { name: /home/i })).not.toBeInTheDocument();
  });

  it('offers a Home link to the storefront when asked', () => {
    render(<BackHeader title="Checkout" showHome />);

    const home = screen.getByRole('link', { name: /home/i });
    expect(home).toBeInTheDocument();
    expect(home).toHaveAttribute('href', '/');
  });

  it('still renders the back control alongside Home', () => {
    render(<BackHeader title="Checkout" showHome />);

    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
    expect(screen.getByText('Checkout')).toBeInTheDocument();
  });

  it('runs a supplied onBack instead of router.back()', async () => {
    const onBack = vi.fn();
    render(<BackHeader title="Checkout" onBack={onBack} showHome />);

    screen.getByRole('button', { name: /go back/i }).click();

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
});

// The shortcut the customer uses to reach their own orders. It rides the header
// rather than each page so one placement covers every board tab, and it sits
// next to the cart because that is the control they already look to on the
// right-hand side of the header.
describe('Orders shortcut in the headers', () => {
  it('sits beside the cart on a board header when signed in', () => {
    auth = { user: signedIn, loading: false };

    render(<SectionHeader title="Kahati Board" />);

    const cart = screen.getByRole('link', { name: /^cart/i });
    const orders = screen.getByRole('link', { name: 'My orders' });
    expect(orders).toHaveAttribute('href', '/orders');
    expect(cart.nextElementSibling).toBe(orders);
  });

  it('sits beside the cart on the home header when signed in', () => {
    auth = { user: signedIn, loading: false };

    // The home header's cart is the compact icon button, which carries no
    // accessible name of its own — matched by destination instead.
    const { container } = render(<AppHeader />);

    const cart = container.querySelector('a[href="/cart"]');
    const orders = screen.getByRole('link', { name: 'My orders' });
    expect(cart?.nextElementSibling).toBe(orders);
  });

  it('is absent from a board header for a signed-out visitor', () => {
    render(<SectionHeader title="Kahati Board" />);

    expect(screen.queryByRole('link', { name: 'My orders' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^cart/i })).toBeInTheDocument();
  });

  it('is absent from the home header for a signed-out visitor', () => {
    render(<AppHeader />);

    expect(screen.queryByRole('link', { name: 'My orders' })).not.toBeInTheDocument();
  });
});
