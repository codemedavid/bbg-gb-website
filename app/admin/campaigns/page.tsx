import { redirect } from 'next/navigation';

// The campaign board moved into the Group Buy section, which now owns the whole
// workflow — list, create and edit. Bookmarks, browser history and links
// written down before the move still point here, so this forwards rather than
// 404ing. The screen itself lives at app/admin/group-buy/campaigns.
export default function LegacyCampaignsPage() {
  redirect('/admin/group-buy/campaigns');
}
