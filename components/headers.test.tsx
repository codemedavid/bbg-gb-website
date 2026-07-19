// BackHeader — the Checkout page's only navigation. Checkout sits outside the
// bottom nav, so without an explicit Home link the page is a dead end.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const back = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back, push, replace: vi.fn(), prefetch: vi.fn() }),
}));
// AuthControl (used by the other headers) pulls in the auth context; BackHeader
// does not, so a minimal stub keeps this file focused on navigation.
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

const { BackHeader } = await import('./headers');

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
