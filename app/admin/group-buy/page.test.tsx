// Admin → Group Buy, the section's front door.
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const AdminGroupBuyPage = (await import('./page')).default;

it('leads into the campaigns board', () => {
  render(<AdminGroupBuyPage />);

  expect(screen.getByRole('heading', { name: /^group buy$/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /campaigns/i })).toHaveAttribute('href', '/admin/group-buy/campaigns');
});

// The breadcrumb is what makes Admin → Group Buy → Campaigns → Create Campaign
// visible as the path the client described, rather than four unrelated screens.
it('shows where it sits under Admin', () => {
  render(<AdminGroupBuyPage />);

  const trail = screen.getByRole('navigation', { name: /breadcrumb/i });
  expect(trail).toHaveTextContent('Admin');
  expect(trail).toHaveTextContent('Group Buy');
});
