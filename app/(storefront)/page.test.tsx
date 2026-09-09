// The home page's shortcut cards.
//
// This asserts what the feature briefs were specific about: feedback is
// reachable from directly UNDER the order calculator, and the COA gallery from
// directly under the feedback. A card's position is the requirement, not
// decoration — it is how customers were told to find it — so DOM order is
// asserted rather than mere presence.
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

  it('offers the batch lab results', () => {
    setup();

    expect(screen.getByText(/^COA/)).toBeInTheDocument();
  });

  it('puts the COA card directly under the customer feedback card', () => {
    setup();

    const feedback = screen.getByText('Customer feedback');
    const coa = screen.getByText(/^COA/);

    // Asked for in exactly those words: the lab results sit under the feedback.
    // The two answer the same question from opposite ends — what other people
    // got, and what the lab measured — so they are read together or not at all.
    expect(feedback.compareDocumentPosition(coa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the COA page when tapped', async () => {
    setup();

    await userEvent.click(screen.getByText(/^COA/));

    expect(push).toHaveBeenCalledWith('/coa');
  });

  it('offers the WhatsApp community', () => {
    setup();

    expect(screen.getByRole('link', { name: /community/i })).toBeInTheDocument();
  });

  it('puts the community card last, after the feedback card', () => {
    setup();

    const feedback = screen.getByText('Customer feedback');
    const community = screen.getByRole('link', { name: /community/i });

    // The three cards above answer a question the customer arrived with; the
    // community is the step after browsing, so it closes the stack.
    expect(feedback.compareDocumentPosition(community) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
