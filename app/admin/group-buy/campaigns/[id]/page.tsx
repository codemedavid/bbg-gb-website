'use client';
// Admin → Group Buy → Campaigns → Edit.
//
// A real route means the URL can be typed, bookmarked or reloaded, so this
// fetches the campaign itself rather than assuming the list is in cache. The
// form is mounted only once the campaign has arrived: it seeds its draft from
// `initial` on mount, and seeding it from an empty placeholder would leave the
// admin editing a blank campaign that saves over a real one.
import { useParams } from 'next/navigation';
import { useCampaign } from '@/lib/admin-api';
import { Breadcrumb } from '../../Breadcrumb';
import { CampaignForm } from '../CampaignForm';
import { campaignDraftFrom } from '@/lib/campaign-form';

export default function EditCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign, isLoading, error } = useCampaign(id);

  return (
    <>
      <Breadcrumb trail={[
        { label: 'Admin', href: '/admin' },
        { label: 'Group Buy', href: '/admin/group-buy' },
        { label: 'Campaigns', href: '/admin/group-buy/campaigns' },
        { label: campaign?.name ?? 'Edit Campaign' },
      ]} />

      {isLoading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : !campaign ? (
        // A deleted campaign, a mistyped id, or a server that would not answer.
        // Saying so beats a blank form that would quietly create a second
        // campaign instead of editing one. The two cases read differently: a
        // refusal carries its reason, an empty answer carries none.
        <div className="rounded-[16px] bg-white p-8 text-center shadow-card">
          <div className="mb-1 font-bold text-ink-body">
            {error ? 'Could not load this campaign' : 'Campaign not found'}
          </div>
          <div className="text-[13px] text-ink-muted">
            {error instanceof Error ? error.message : 'It may have been deleted, or the link may be wrong.'}
          </div>
        </div>
      ) : (
        <CampaignForm draftId={campaign.id} initial={campaignDraftFrom(campaign)} />
      )}
    </>
  );
}
