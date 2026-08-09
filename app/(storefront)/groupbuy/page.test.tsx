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

// Card headings, read in DOM order — the list doubles as the board's ordering.
const cardNames = (): string[] =>
  screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');

describe('GroupBuyPage — search', () => {
  beforeEach(() => {
    authState = signedIn;
    campaignState = {
      data: [
        campaign({ id: 'reta', name: 'Retatrutide 20mg', committed: 8 }),
        campaign({ id: 'sema', name: 'Semaglutide 5mg', committed: 2 }),
        campaign({ id: 'aod', name: 'AOD9604 Pro Max', committed: 5 }),
      ],
      isLoading: false,
    };
  });

  it('narrows the board to campaigns matching the name', async () => {
    render(<GroupBuyPage />);

    await userEvent.type(screen.getByRole('searchbox'), 'semaglutide');

    expect(cardNames()).toEqual(['Semaglutide 5mg']);
  });

  it('matches a product carried inside the batch, not only the batch title', async () => {
    // A campaign named "August Peptide Run" still holds Tirzepatide vials, and
    // the customer searches for the vial.
    campaignState = {
      data: [campaign({
        id: 'aug', name: 'August Peptide Run',
        includedProducts: [{ productId: 'p1', name: 'Tirzepatide 30mg' }],
      })],
      isLoading: false,
    };
    render(<GroupBuyPage />);

    await userEvent.type(screen.getByRole('searchbox'), 'tirzepatide');

    expect(cardNames()).toEqual(['August Peptide Run']);
  });

  it('matches the variant/specification', async () => {
    render(<GroupBuyPage />);

    await userEvent.type(screen.getByRole('searchbox'), '20mg');

    expect(cardNames()).toEqual(['Retatrutide 20mg']);
  });

  it('reports an empty search distinctly from an empty board', async () => {
    render(<GroupBuyPage />);

    await userEvent.type(screen.getByRole('searchbox'), 'insulin');

    expect(screen.getByText(/no group buys match/i)).toBeInTheDocument();
    expect(screen.queryByText(/no group buys open right now/i)).not.toBeInTheDocument();
  });

  it('searches closed batches too, so a customer is not told we never carried it', async () => {
    campaignState = {
      data: [campaign({ id: 'done', name: 'Retatrutide 20mg', status: 'approved', outcome: 'processing' })],
      isLoading: false,
    };
    render(<GroupBuyPage />);

    await userEvent.type(screen.getByRole('searchbox'), 'retatrutide');

    expect(cardNames()).toEqual(['Retatrutide 20mg']);
    expect(screen.getByRole('heading', { name: /^closed$/i })).toBeInTheDocument();
  });
});

describe('GroupBuyPage — sorting', () => {
  beforeEach(() => {
    authState = signedIn;
    campaignState = {
      data: [
        campaign({ id: 'reta', name: 'Retatrutide 20mg', committed: 8 }),
        campaign({ id: 'sema', name: 'Semaglutide 5mg', committed: 2 }),
        campaign({ id: 'aod', name: 'AOD9604 Pro Max', committed: 5 }),
      ],
      isLoading: false,
    };
  });

  it('leaves the admin-configured order alone by default', () => {
    render(<GroupBuyPage />);

    expect(cardNames()).toEqual(['Retatrutide 20mg', 'Semaglutide 5mg', 'AOD9604 Pro Max']);
  });

  it('sorts A–Z', async () => {
    render(<GroupBuyPage />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'az');

    expect(cardNames()).toEqual(['AOD9604 Pro Max', 'Retatrutide 20mg', 'Semaglutide 5mg']);
  });

  it('sorts Z–A', async () => {
    render(<GroupBuyPage />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'za');

    expect(cardNames()).toEqual(['Semaglutide 5mg', 'Retatrutide 20mg', 'AOD9604 Pro Max']);
  });

  it('leads with the most kits committed when asked', async () => {
    render(<GroupBuyPage />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'progress');

    expect(cardNames()).toEqual(['Retatrutide 20mg', 'AOD9604 Pro Max', 'Semaglutide 5mg']);
  });

  it('sorts only what the search matched', async () => {
    campaignState = {
      data: [
        campaign({ id: 'r10', name: 'Retatrutide 10mg', committed: 1 }),
        campaign({ id: 'sema', name: 'Semaglutide 5mg', committed: 9 }),
        campaign({ id: 'r20', name: 'Retatrutide 20mg', committed: 4 }),
      ],
      isLoading: false,
    };
    render(<GroupBuyPage />);

    await userEvent.type(screen.getByRole('searchbox'), 'retatrutide');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'progress');

    expect(cardNames()).toEqual(['Retatrutide 20mg', 'Retatrutide 10mg']);
  });
});

describe('GroupBuyPage — cart shortcut', () => {
  it('offers a cart shortcut on the board with the live item count', () => {
    campaignState = { data: [], isLoading: false };
    useCart.getState().add({
      key: 'gbuy:c1', kind: 'moq_campaign', refId: 'c1', name: 'Retatrutide — group buy',
      spec: 'Group buy', unitPricePhp: 9000, minQty: 1, qty: 3,
    });
    render(<GroupBuyPage />);

    const cart = screen.getByRole('link', { name: /^cart,/i });
    expect(cart).toHaveAttribute('href', '/cart');
    expect(cart).toHaveTextContent('Cart (3)');
  });
});
