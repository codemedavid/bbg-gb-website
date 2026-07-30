'use client';
// Admin → Group Buy → Campaigns → Create Campaign.
import { Breadcrumb } from '../../Breadcrumb';
import { CampaignForm } from '../CampaignForm';
import { emptyCampaignDraft } from '@/lib/campaign-form';

export default function NewCampaignPage() {
  return (
    <>
      <Breadcrumb trail={[
        { label: 'Admin', href: '/admin' },
        { label: 'Group Buy', href: '/admin/group-buy' },
        { label: 'Campaigns', href: '/admin/group-buy/campaigns' },
        { label: 'Create Campaign' },
      ]} />
      {/* 'new' keys the draft: an abandoned create must not reappear inside an
          edit, and vice versa. */}
      <CampaignForm draftId="new" initial={emptyCampaignDraft} />
    </>
  );
}
