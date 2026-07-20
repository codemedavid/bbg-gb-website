// The Group Buy board page.
//
// Written after the fact to close a 0%-coverage gap — and the first thing it
// caught is the reason the gap mattered: startCommit gated on `user` alone while
// ignoring `loading`, so a signed-in customer who lands on this page fresh and
// taps "Commit kits" before /auth/me resolves is thrown onto the login screen.
// app/checkout/page.tsx already guards with `!loading && !user`; this page did not.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MoqCampaign } from '@/lib/types';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), prefetch: vi.fn() }),
}));

// Auth state is swapped per test to model the /auth/me round-trip.
let authState: { user: unknown; loading: boolean } = { user: null, loading: false };
vi.mock('@/lib/useAuth', () => ({ useAuth: () => authState }));

let campaignState: { data: MoqCampaign[]; isLoading: boolean } = { data: [], isLoading: false };
vi.mock('@/lib/queries', () => ({ useCampaigns: () => campaignState }));

const GroupBuyPage = (await import('./page')).default;

const campaign = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'c1', name: 'Retatrutide 20mg', pricePerKitPhp: '9000.00', moq: 10, committed: 4,
  perCustomerMin: 1, shippingPhp: '300.00', status: 'open', deadline: null,
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-07-01T00:00:00Z',
  progress: 0.4, remaining: 6, reached: false, outcome: 'awaiting_moq',
  ...o,
});

const signedIn = { user: { id: 'u1', name: 'Ana Reyes', phone: '0917', address: '12 Mabini St' }, loading: false };
const anonymous = { user: null, loading: false };
const stillLoading = { user: null, loading: true };

beforeEach(() => {
  push.mockReset();
  authState = anonymous;
  campaignState = { data: [], isLoading: false };
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
});

describe('GroupBuyPage — auth gating on commit', () => {
  it('sends a genuinely anonymous visitor to log in', async () => {
    authState = anonymous;
    campaignState = { data: [campaign()], isLoading: false };
    render(<GroupBuyPage />);

    await userEvent.click(screen.getByRole('button', { name: /commit kits/i }));

    expect(push).toHaveBeenCalledWith('/login');
  });

  it('does not bounce a signed-in customer to login while auth is still resolving', async () => {
    // The window between first paint and /auth/me returning. The customer HAS a
    // session; the client just does not know it yet.
    authState = stillLoading;
    campaignState = { data: [campaign()], isLoading: false };
    render(<GroupBuyPage />);

    await userEvent.click(screen.getByRole('button', { name: /commit kits/i }));

    expect(push).not.toHaveBeenCalledWith('/login');
  });

  it('opens the commit sheet once the session is known', async () => {
    authState = signedIn;
    campaignState = { data: [campaign()], isLoading: false };
    render(<GroupBuyPage />);

    await userEvent.click(screen.getByRole('button', { name: /commit kits/i }));

    expect(await screen.findByRole('dialog', { name: /commit to retatrutide/i })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('GroupBuyPage — board rendering', () => {
  it('separates open campaigns from closed ones', () => {
    authState = signedIn;
    campaignState = {
      data: [campaign({ id: 'a', name: 'Open One', status: 'open' }),
             campaign({ id: 'b', name: 'Done One', status: 'approved', outcome: 'processing' })],
      isLoading: false,
    };
    render(<GroupBuyPage />);

    expect(screen.getByRole('heading', { name: /^closed$/i })).toBeInTheDocument();
    expect(screen.getByText('Open One')).toBeInTheDocument();
    expect(screen.getByText('Done One')).toBeInTheDocument();
  });

  it('tells the customer when nothing is running rather than showing a bare page', () => {
    campaignState = { data: [], isLoading: false };
    render(<GroupBuyPage />);

    expect(screen.getByText(/no group buys open/i)).toBeInTheDocument();
  });

  it('shows a loading state instead of the empty message while fetching', () => {
    campaignState = { data: [], isLoading: true };
    render(<GroupBuyPage />);

    expect(screen.getByText(/loading group buys/i)).toBeInTheDocument();
    expect(screen.queryByText(/no group buys open/i)).not.toBeInTheDocument();
  });

  it('points customers at the Kahati board, since the two features are separate', () => {
    campaignState = { data: [], isLoading: false };
    render(<GroupBuyPage />);

    expect(screen.getByRole('button', { name: /go to kahati/i })).toBeInTheDocument();
  });
});
