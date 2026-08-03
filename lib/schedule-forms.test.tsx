// The "Opens at" control on both admin forms.
//
// The whole feature is invisible unless the admin can type a date, so the field
// is pinned on each board's real form — not only on the payload builder it feeds.
// A payload test alone passes happily while the input is missing from the screen,
// which is the exact bug this feature started as.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyCampaignDraft, campaignPayloadFrom, validateCampaignDraft } from '@/lib/campaign-form';
import type { MoqCampaign, Product } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

let products: Pick<Product, 'id' | 'name'>[] = [];
const saveCampaign = vi.fn();
const saveGroupBuy = vi.fn();

vi.mock('@/lib/admin-api', () => ({
  useAdminProducts: () => ({ data: products }),
  useAdminGroupBuys: () => ({ data: [], isLoading: false }),
  useAdminGroupBuyCommitments: () => ({ data: [] }),
  useMutate: () => ({
    saveCampaign: { mutateAsync: saveCampaign, isPending: false },
    saveGroupBuy: { mutateAsync: saveGroupBuy, isPending: false },
    deleteGroupBuy: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

const { CampaignForm } = await import('@/app/admin/group-buy/campaigns/CampaignForm');

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  sessionStorage.clear();
  products = [];
  saveCampaign.mockReset().mockResolvedValue(undefined);
  saveGroupBuy.mockReset().mockResolvedValue(undefined);
});

describe('Group Buy campaign form', () => {
  it('offers an Opens at field', () => {
    render(<CampaignForm initial={emptyCampaignDraft} />);

    expect(screen.getByLabelText(/opens at/i)).toBeInTheDocument();
  });

  it('sends the typed open date to the API', async () => {
    render(<CampaignForm initial={emptyCampaignDraft} />);

    await userEvent.type(screen.getByLabelText(/^name$/i), 'Retatrutide 30mg');
    const price = screen.getByLabelText(/price \/ kit/i);
    await userEvent.clear(price);
    await userEvent.type(price, '5200');
    await userEvent.type(screen.getByLabelText(/opens at/i), '2026-12-01T09:00');
    await userEvent.click(screen.getByRole('button', { name: /save campaign/i }));

    expect(saveCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ opensAt: new Date('2026-12-01T09:00').toISOString() }),
    );
  });
});

describe('campaign draft rules', () => {
  it('carries the open date into the payload', () => {
    const opensAt = new Date(Date.now() + DAY).toISOString();

    expect(campaignPayloadFrom({ ...emptyCampaignDraft, opensAt })).toMatchObject({ opensAt });
  });

  it('refuses a draft that opens at or after its deadline', () => {
    const draft = {
      ...emptyCampaignDraft, name: 'Valid name', pricePerKitPhp: '5200',
      opensAt: new Date(Date.now() + 5 * DAY).toISOString(),
      deadline: new Date(Date.now() + 2 * DAY).toISOString(),
    };

    expect(validateCampaignDraft(draft)).toMatch(/before/i);
  });

  it('accepts a draft with no open date', () => {
    const draft = { ...emptyCampaignDraft, name: 'Valid name', pricePerKitPhp: '5200' };

    expect(validateCampaignDraft(draft)).toBeNull();
  });
});

describe('Kahati admin form', () => {
  it('offers an Opens at field', async () => {
    const { default: AdminGroupBuysPage } = await import('@/app/admin/groupbuys/page');
    render(<AdminGroupBuysPage />);

    await userEvent.click(screen.getByRole('button', { name: /new group buy/i }));

    expect(screen.getByLabelText(/opens at/i)).toBeInTheDocument();
  });
});
