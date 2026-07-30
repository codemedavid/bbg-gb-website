// /admin/campaigns is where the campaign board used to live.
//
// The board moved under the Group Buy section. Bookmarks, the browser's history
// and any link written down before the move still point here, so the old path
// forwards rather than 404s.
import { it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect }));

const LegacyCampaignsPage = (await import('./page')).default;

beforeEach(() => redirect.mockReset());

it('forwards to the campaigns board in its new home', () => {
  LegacyCampaignsPage();
  expect(redirect).toHaveBeenCalledWith('/admin/group-buy/campaigns');
});
