// The home page's shortcut cards.
//
// This asserts one thing the feature brief is specific about: feedback is
// reachable from directly UNDER the order calculator. The card's position is
// the requirement, not decoration — it is how customers were told to find it —
// so DOM order is asserted rather than mere presence.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/lib/queries', () => ({
  useGroupBuys: () => ({ data: [], isLoading: false }),
  useKahatiDownpaymentPolicy: () => ({ data: undefined, isSuccess: true }),
  useMoqPageEnabled: () => ({ data: false }),
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false, logout: vi.fn() }),
}));

const HomePage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const setup = () => render(<HomePage />, { wrapper });

describe('Home shortcut cards', () => {
  it('offers customer feedback', () => {
    setup();

    expect(screen.getByText('Customer feedback')).toBeInTheDocument();
  });

  it('puts the feedback card directly under the order calculator', () => {
    setup();

    const orderCalc = screen.getByText('Order calculator');
    const feedback = screen.getByText('Customer feedback');

    // DOCUMENT_POSITION_FOLLOWING === 4: feedback comes after the calculator.
    expect(orderCalc.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the feedback page when tapped', async () => {
    setup();

    await userEvent.click(screen.getByText('Customer feedback'));

    expect(push).toHaveBeenCalledWith('/feedback');
  });
});
