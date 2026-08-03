// Edit Campaign, reached at /admin/group-buy/campaigns/:id.
//
// A real route means the URL can be typed, bookmarked or reloaded, so the page
// fetches the campaign itself rather than relying on the list being in cache.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MoqCampaign } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

let feed: { data?: MoqCampaign; isLoading: boolean; error: Error | null } =
  { data: undefined, isLoading: false, error: null };

vi.mock('@/lib/admin-api', () => ({
  useCampaign: () => feed,
  useAdminProducts: () => ({ data: [] }),
  useMutate: () => ({ saveCampaign: { mutateAsync: vi.fn(), isPending: false } }),
}));

const EditCampaignPage = (await import('./page')).default;

const campaign = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'c1', name: 'Retatrutide 30mg', pricePerKitPhp: '5200.00', moq: 10, committed: 4,
  perCustomerMin: 1, shippingPhp: '300.00', status: 'open', opensAt: null, deadline: null,
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-07-01T00:00:00.000Z', seriesId: 'c1', batchNo: 1,
  capacity: 10, progress: 0.4, remaining: 6, reached: false, full: false,
  outcome: 'awaiting_moq',
  ...o,
});

beforeEach(() => {
  sessionStorage.clear();
  feed = { data: undefined, isLoading: false, error: null };
});

it('waits for the campaign rather than flashing an empty form', () => {
  feed = { data: undefined, isLoading: true, error: null };
  render(<EditCampaignPage />);

  expect(screen.getByText(/loading/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();
});

it('prefills the form from the fetched campaign', () => {
  feed = { data: campaign(), isLoading: false, error: null };
  render(<EditCampaignPage />);

  expect(screen.getByLabelText(/^name$/i)).toHaveValue('Retatrutide 30mg');
  expect(screen.getByRole('heading', { name: /edit campaign/i })).toBeInTheDocument();
});

// A deleted campaign, or a mistyped id, must say so — not render a blank form
// that would silently create a second campaign on save.
it('says so when the campaign cannot be found', () => {
  feed = { data: undefined, isLoading: false, error: new Error('Campaign not found.') };
  render(<EditCampaignPage />);

  expect(screen.getByText(/not found/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();
});
