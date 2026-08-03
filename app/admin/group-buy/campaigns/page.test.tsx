// Admin → Group Buy → Campaigns.
//
// The list keeps the lifecycle actions (approve, extend, cancel, delete) that
// only make sense against a whole campaign, and hands creating and editing off
// to their own routes. The screen this replaces had no tests at all, so these
// cover the behaviour that moved as well as the routing that is new.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import type { MoqCampaign } from '@/lib/types';

// Cancel and delete route through the shared confirm dialog.
const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

let feed: { data: MoqCampaign[]; isLoading: boolean } = { data: [], isLoading: false };
const deleteMutate = vi.fn();
const actionMutate = vi.fn();
const actionMutateAsync = vi.fn();

vi.mock('@/lib/admin-api', () => ({
  useCampaigns: () => feed,
  useMutate: () => ({
    deleteCampaign: { mutate: deleteMutate, isPending: false },
    campaignAction: { mutate: actionMutate, mutateAsync: actionMutateAsync, isPending: false },
  }),
}));

const AdminCampaignsPage = (await import('./page')).default;

const campaign = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'c1', name: 'Retatrutide 30mg', pricePerKitPhp: '5200.00', moq: 10, committed: 4,
  perCustomerMin: 1, shippingPhp: '300.00', status: 'open', opensAt: null, deadline: null,
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-07-01T00:00:00.000Z', seriesId: 'c1', batchNo: 1,
  capacity: 10, progress: 0.4, remaining: 6, reached: false, full: false,
  outcome: 'awaiting_moq',
  ...o,
});

const card = (id: string) => screen.getByTestId(`campaign-${id}`);

beforeEach(() => {
  feed = { data: [], isLoading: false };
  push.mockReset();
  deleteMutate.mockReset();
  actionMutate.mockReset();
  actionMutateAsync.mockReset().mockResolvedValue(undefined);
});

describe('the list', () => {
  it('shows a loading state while campaigns are fetching', () => {
    feed = { data: [], isLoading: true };
    render(<AdminCampaignsPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the batch and progress of each campaign', () => {
    feed = { data: [campaign({ batchNo: 2, committed: 4, capacity: 10, remaining: 6 })], isLoading: false };
    render(<AdminCampaignsPage />);

    expect(within(card('c1')).getByText(/batch #2/i)).toBeInTheDocument();
    expect(within(card('c1')).getByText(/4\/10 kits/i)).toBeInTheDocument();
  });

  it('says the board is empty rather than showing nothing at all', () => {
    render(<AdminCampaignsPage />);
    expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument();
  });
});

describe('reaching the create and edit screens', () => {
  it('opens the Create Campaign page', async () => {
    render(<AdminCampaignsPage />);
    await userEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    expect(push).toHaveBeenCalledWith('/admin/group-buy/campaigns/new');
  });

  it('opens the Edit page for the campaign that was clicked', async () => {
    feed = { data: [campaign({ id: 'c7' })], isLoading: false };
    render(<AdminCampaignsPage />);
    await userEvent.click(screen.getByRole('button', { name: /edit retatrutide 30mg/i }));
    expect(push).toHaveBeenCalledWith('/admin/group-buy/campaigns/c7');
  });

  // The whole point of the move: the form is a page now, so nothing about it
  // should appear over the list.
  it('does not open a form on top of the list', async () => {
    render(<AdminCampaignsPage />);
    await userEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();
  });
});

describe('lifecycle actions stay on the list', () => {
  it('approves an open campaign', async () => {
    feed = { data: [campaign({ id: 'c1', status: 'open' })], isLoading: false };
    render(<AdminCampaignsPage />);
    await userEvent.click(screen.getByRole('button', { name: /approve retatrutide 30mg/i }));
    expect(actionMutate).toHaveBeenCalledWith({ id: 'c1', action: 'approve' });
  });

  it('extends an open campaign to a new deadline', async () => {
    feed = { data: [campaign({ id: 'c1', status: 'open' })], isLoading: false };
    render(<AdminCampaignsPage />);
    await userEvent.click(screen.getByRole('button', { name: /extend retatrutide 30mg/i }));
    await userEvent.type(await screen.findByLabelText(/new deadline/i), '2026-09-30T16:00');
    await userEvent.click(screen.getByRole('button', { name: /^extend$/i }));

    await waitFor(() => expect(actionMutateAsync).toHaveBeenCalled());
    expect(actionMutateAsync.mock.calls[0][0]).toMatchObject({ id: 'c1', action: 'extend' });
  });

  it('cancels only after the warning is confirmed', async () => {
    feed = { data: [campaign({ id: 'c1', status: 'open' })], isLoading: false };
    render(<AdminCampaignsPage />);
    await userEvent.click(screen.getByRole('button', { name: /cancel retatrutide 30mg/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^cancel campaign$/i }));

    await waitFor(() => expect(actionMutate).toHaveBeenCalledWith({ id: 'c1', action: 'cancel' }));
  });

  // A full batch needs no approval and takes no extension, but a supplier can
  // still fall through after it closed — so cancel stays available.
  it('still offers cancel on a completed batch, but not approve', () => {
    feed = { data: [campaign({ status: 'completed' })], isLoading: false };
    render(<AdminCampaignsPage />);
    expect(screen.getByRole('button', { name: /cancel retatrutide 30mg/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve retatrutide 30mg/i })).not.toBeInTheDocument();
  });

  it('deletes only after the warning is confirmed', async () => {
    feed = { data: [campaign({ id: 'c1' })], isLoading: false };
    render(<AdminCampaignsPage />);
    await userEvent.click(screen.getByRole('button', { name: /delete retatrutide 30mg/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete campaign$/i }));

    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('c1'));
  });
});
