// The admin controls for ending a batch and starting the next one.
//
// Two of them: one per card, for a single group buy, and one on the board, for
// the whole cycle. Both go through the same rollover — the batch is sealed and
// its successor opens inside the same series.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import type { MoqCampaign } from '@/lib/types';

const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

let feed: { data: MoqCampaign[]; isLoading: boolean } = { data: [], isLoading: false };
const deleteMutate = vi.fn();
const actionMutate = vi.fn();
const cycleMutate = vi.fn();

vi.mock('@/lib/admin-api', () => ({
  useCampaigns: () => feed,
  useMutate: () => ({
    deleteCampaign: { mutate: deleteMutate, isPending: false },
    campaignAction: { mutate: actionMutate, mutateAsync: vi.fn(), isPending: false },
    startCycle: { mutate: cycleMutate, isPending: false },
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
  cycleMutate.mockReset();
});

describe('ending one batch', () => {
  it('offers to end a running batch and start the next', async () => {
    feed = { data: [campaign()], isLoading: false };
    render(<AdminCampaignsPage />);

    await userEvent.click(within(card('c1')).getByRole('button', { name: /end batch #1 of Retatrutide 30mg/i }));

    // Confirmed first: it closes a batch customers are committed to.
    await userEvent.click(await screen.findByRole('button', { name: 'End batch & start next' }));

    await waitFor(() => expect(actionMutate).toHaveBeenCalledWith({ id: 'c1', action: 'roll' }));
  });

  it('says the customers keep their orders, since the admin settles those', async () => {
    feed = { data: [campaign()], isLoading: false };
    render(<AdminCampaignsPage />);

    await userEvent.click(within(card('c1')).getByRole('button', { name: /end batch #1 of Retatrutide 30mg/i }));

    expect(await screen.findByText(/orders are not changed/i)).toBeInTheDocument();
  });

  it('writes nothing when the confirm is declined', async () => {
    feed = { data: [campaign()], isLoading: false };
    render(<AdminCampaignsPage />);

    await userEvent.click(within(card('c1')).getByRole('button', { name: /end batch #1 of Retatrutide 30mg/i }));
    await userEvent.click(await screen.findByRole('button', { name: /keep it running/i }));

    expect(actionMutate).not.toHaveBeenCalled();
  });

  // A batch that already ended has nothing to roll, and a completed one opened
  // its successor when it filled.
  it.each(['approved', 'completed', 'cancelled'] as const)('does not offer to end a %s batch', (status) => {
    feed = { data: [campaign({ status })], isLoading: false };
    render(<AdminCampaignsPage />);

    expect(within(card('c1')).queryByRole('button', { name: /end batch/i })).toBeNull();
  });
});

describe('starting a new cycle', () => {
  it('rolls the whole board once confirmed', async () => {
    feed = { data: [campaign(), campaign({ id: 'c2', seriesId: 'c2', name: 'BAC Water 3ml' })], isLoading: false };
    render(<AdminCampaignsPage />);

    await userEvent.click(screen.getByRole('button', { name: /start new cycle/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'End all & start next' }));

    await waitFor(() => expect(cycleMutate).toHaveBeenCalled());
  });

  it('warns that batches nobody joined stay open', async () => {
    feed = { data: [campaign()], isLoading: false };
    render(<AdminCampaignsPage />);

    await userEvent.click(screen.getByRole('button', { name: /start new cycle/i }));

    expect(await screen.findByText(/nobody has joined stay open/i)).toBeInTheDocument();
  });

  it('writes nothing when the confirm is declined', async () => {
    feed = { data: [campaign()], isLoading: false };
    render(<AdminCampaignsPage />);

    await userEvent.click(screen.getByRole('button', { name: /start new cycle/i }));
    await userEvent.click(await screen.findByRole('button', { name: /keep the board/i }));

    expect(cycleMutate).not.toHaveBeenCalled();
  });

  // Nothing running means nothing to end; the control would be a no-op button.
  it('hides the cycle control when no batch is running', () => {
    feed = { data: [campaign({ status: 'approved' })], isLoading: false };
    render(<AdminCampaignsPage />);

    expect(screen.queryByRole('button', { name: /start new cycle/i })).toBeNull();
  });
});
