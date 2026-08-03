// Create / Edit Campaign — the dedicated screen.
//
// The client asked for the campaign workflow to leave the shared admin modal and
// live on its own page, with a Back button that does not cost the admin what
// they had typed. Those two asks pull against each other: a routed form unmounts
// when you leave it, so "preserve entered data" is the thing most likely to
// regress silently. It is tested here end to end through the form, not only at
// the storage layer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyCampaignDraft, campaignDraftFrom } from '@/lib/campaign-form';
import { readCampaignDraft } from '@/lib/campaign-draft';
import type { MoqCampaign, Product } from '@/lib/types';

const push = vi.fn();
const back = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back, replace: vi.fn(), prefetch: vi.fn() }),
}));

let products: Pick<Product, 'id' | 'name'>[] = [];
const saveMutate = vi.fn();
let savePending = false;

vi.mock('@/lib/admin-api', () => ({
  useAdminProducts: () => ({ data: products }),
  useMutate: () => ({ saveCampaign: { mutateAsync: saveMutate, isPending: savePending } }),
}));

const { CampaignForm } = await import('./CampaignForm');

const campaign = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'c1', name: 'Retatrutide 30mg', pricePerKitPhp: '5200.00', moq: 10, committed: 4,
  perCustomerMin: 1, shippingPhp: '300.00', status: 'open', opensAt: null, deadline: null,
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-07-01T00:00:00.000Z', seriesId: 'c1', batchNo: 1,
  capacity: 10, progress: 0.4, remaining: 6, reached: false, full: false,
  outcome: 'awaiting_moq',
  ...o,
});

const nameBox = () => screen.getByLabelText(/^name$/i);
const priceBox = () => screen.getByLabelText(/price \/ kit/i);
const save = () => userEvent.click(screen.getByRole('button', { name: /save campaign/i }));
const goBack = () => userEvent.click(screen.getByRole('button', { name: /back to campaigns/i }));

// The minimum a campaign needs to be savable.
const fillValid = async () => {
  await userEvent.type(nameBox(), 'Retatrutide 30mg');
  await userEvent.clear(priceBox());
  await userEvent.type(priceBox(), '5200');
};

beforeEach(() => {
  sessionStorage.clear();
  push.mockReset();
  back.mockReset();
  saveMutate.mockReset().mockResolvedValue(undefined);
  savePending = false;
  products = [];
});

describe('the screen', () => {
  it('names itself Create Campaign for a new campaign', () => {
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    expect(screen.getByRole('heading', { name: /create campaign/i })).toBeInTheDocument();
  });

  it('names itself Edit Campaign for an existing one', () => {
    render(<CampaignForm draftId="c1" initial={campaignDraftFrom(campaign())} />);
    expect(screen.getByRole('heading', { name: /edit campaign/i })).toBeInTheDocument();
    expect(nameBox()).toHaveValue('Retatrutide 30mg');
  });
});

describe('the Back button', () => {
  it('returns to the campaigns list', async () => {
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await goBack();
    expect(push).toHaveBeenCalledWith('/admin/group-buy/campaigns');
  });

  // An explicit destination, not router.back(): Create is reachable from the
  // list and from a deep link, and history would send those two somewhere
  // different — one of them off the campaign workflow entirely.
  it('does not fall through to browser history', async () => {
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await goBack();
    expect(back).not.toHaveBeenCalled();
  });
});

describe('preserving entered data', () => {
  it('still holds what was typed after leaving and returning', async () => {
    const first = render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await fillValid();
    await goBack();
    first.unmount();

    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await waitFor(() => expect(nameBox()).toHaveValue('Retatrutide 30mg'));
    expect(priceBox()).toHaveValue(5200);
  });

  it('says so, rather than leaving the admin wondering why the form is filled', async () => {
    const first = render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await fillValid();
    first.unmount();

    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    expect(await screen.findByText(/unsaved draft/i)).toBeInTheDocument();
  });

  it('discards the draft on request and empties the form', async () => {
    const first = render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await fillValid();
    first.unmount();

    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await userEvent.click(await screen.findByRole('button', { name: /discard draft/i }));

    expect(nameBox()).toHaveValue('');
    expect(readCampaignDraft('new')).toBeNull();
  });

  // Editing batch #2 must never hand back what was typed into batch #1.
  it('does not leak one campaign draft into another', async () => {
    const first = render(<CampaignForm draftId="c1" initial={emptyCampaignDraft} />);
    await userEvent.type(nameBox(), 'Batch one');
    first.unmount();

    render(<CampaignForm draftId="c2" initial={emptyCampaignDraft} />);
    expect(nameBox()).toHaveValue('');
  });
});

describe('saving', () => {
  it('refuses an incomplete campaign and says why', async () => {
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await save();

    expect(await screen.findByRole('alert')).toHaveTextContent(/name/i);
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it('sends what was entered', async () => {
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await fillValid();
    await save();

    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate.mock.calls[0][0]).toMatchObject({ name: 'Retatrutide 30mg', pricePerKitPhp: 5200 });
  });

  it('returns to the list and drops the draft once saved', async () => {
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await fillValid();
    await save();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/group-buy/campaigns'));
    expect(readCampaignDraft('new')).toBeNull();
  });

  // A rejected save must not also throw away the work that was rejected.
  it('shows the reason and keeps the draft when the save fails', async () => {
    saveMutate.mockRejectedValue(new Error('A batch holds at most 10 kits.'));
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await fillValid();
    await save();

    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 10 kits/i);
    expect(push).not.toHaveBeenCalled();
    expect(readCampaignDraft('new')?.name).toBe('Retatrutide 30mg');
  });

  it('disables the save button while the save is in flight', () => {
    savePending = true;
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });
});

describe('included products', () => {
  it('offers the catalog and sends what was ticked', async () => {
    products = [{ id: 'p1', name: 'Reta 30mg' }, { id: 'p2', name: 'BPC-157' }];
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    await fillValid();
    await userEvent.click(screen.getByRole('checkbox', { name: /reta 30mg/i }));
    await save();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(saveMutate.mock.calls[0][0].includedProducts).toEqual([
      { productId: 'p1', name: 'Reta 30mg', outOfStock: false },
    ]);
  });

  it('says so when the catalog is empty instead of showing a blank box', () => {
    render(<CampaignForm draftId="new" initial={emptyCampaignDraft} />);
    expect(screen.getByText(/no products yet/i)).toBeInTheDocument();
  });
});
