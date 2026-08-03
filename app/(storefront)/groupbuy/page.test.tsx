// The Group Buy board page.
//
// It used to gate its CTA on a session, because committing placed a real order
// straight from this page — and gating on `user` while ignoring `loading` threw
// signed-in customers onto the login screen before /auth/me resolved. Committing
// is now add-to-cart against a localStorage cart, so there is nothing to gate:
// the board matches the Kahati board and the shop, and checkout asks for the
// session itself.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCart } from '@/lib/store/cart';
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
  perCustomerMin: 1,
  shippingPhp: '300.00', status: 'open', opensAt: null, deadline: null,
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-07-01T00:00:00Z',
  seriesId: 'c1', batchNo: 1,
  capacity: 10, progress: 0.4, remaining: 6, reached: false, full: false, outcome: 'awaiting_moq',
  ...o,
});

const signedIn = { user: { id: 'u1', name: 'Ana Reyes', phone: '0917', address: '12 Mabini St' }, loading: false };
const anonymous = { user: null, loading: false };
const stillLoading = { user: null, loading: true };

beforeEach(() => {
  push.mockReset();
  authState = anonymous;
  campaignState = { data: [], isLoading: false };
  useCart.getState().clear();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
});

const openSheet = async () => {
  render(<GroupBuyPage />);
  await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));
};

describe('GroupBuyPage — committing kits', () => {
  it('opens the sheet for an anonymous visitor rather than sending them to log in', async () => {
    // The cart is local. Nothing reaches the database until checkout, which
    // requires the session itself.
    authState = anonymous;
    campaignState = { data: [campaign()], isLoading: false };

    await openSheet();

    expect(await screen.findByRole('dialog', { name: /commit to retatrutide/i })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalledWith('/login');
  });

  it('opens the sheet while auth is still resolving', async () => {
    authState = stillLoading;
    campaignState = { data: [campaign()], isLoading: false };

    await openSheet();

    expect(await screen.findByRole('dialog', { name: /commit to retatrutide/i })).toBeInTheDocument();
  });

  it('puts the kits in the cart and keeps the customer on the board', async () => {
    authState = signedIn;
    campaignState = { data: [campaign()], isLoading: false };
    await openSheet();

    await userEvent.click(await screen.findByRole('button', { name: /add to cart ·/i }));

    expect(useCart.getState().items).toMatchObject([{ kind: 'moq_campaign', refId: 'c1' }]);
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
