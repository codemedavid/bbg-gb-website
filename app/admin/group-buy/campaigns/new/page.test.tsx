// Admin → Group Buy → Campaigns → Create Campaign.
//
// The route itself is thin; what it has to get right is which draft key the
// form is given. 'new' is what keeps an abandoned create from reappearing
// inside an edit, so it is asserted through the form rather than assumed.
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readCampaignDraft } from '@/lib/campaign-draft';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/lib/admin-api', () => ({
  useAdminProducts: () => ({ data: [] }),
  useMutate: () => ({ saveCampaign: { mutateAsync: vi.fn(), isPending: false } }),
}));

const NewCampaignPage = (await import('./page')).default;

beforeEach(() => sessionStorage.clear());

it('opens an empty Create Campaign form', () => {
  render(<NewCampaignPage />);

  expect(screen.getByRole('heading', { name: /create campaign/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/^name$/i)).toHaveValue('');
});

it('shows the full path it was reached by', () => {
  render(<NewCampaignPage />);

  const trail = screen.getByRole('navigation', { name: /breadcrumb/i });
  expect(trail).toHaveTextContent('Group Buy');
  expect(trail).toHaveTextContent('Campaigns');
  expect(trail).toHaveTextContent('Create Campaign');
});

it('keeps its draft under the create key, not a campaign id', async () => {
  render(<NewCampaignPage />);
  await userEvent.type(screen.getByLabelText(/^name$/i), 'Retatrutide 30mg');

  expect(readCampaignDraft('new')?.name).toBe('Retatrutide 30mg');
});
