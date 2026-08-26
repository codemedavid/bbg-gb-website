'use client';
// Admin → Group Buy → Campaigns.
//
// The board lists group buys, not batches: each series shows the batch that is
// live now, with the batches before it archived behind it (lib/campaign-series
// decides which is which). The lifecycle actions that act on a whole campaign —
// approve, extend, cancel, delete — live on the cards; creating and editing get
// their own routes.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCampaigns, useMutate } from '@/lib/admin-api';
import { useConfirm } from '@/components/ConfirmDialog';
import { btnPrimary, btnBoardAction } from '@/components/admin-ui';
import { groupBySeries } from '@/lib/campaign-series';
import { Breadcrumb } from '../Breadcrumb';
import { ExtendModal } from './ExtendModal';
import { SeriesGroup } from './SeriesGroup';
import type { CampaignActions } from './CampaignCard';
import type { MoqCampaign } from '@/lib/types';

export default function AdminCampaignsPage() {
  const router = useRouter();
  const { data: campaigns = [], isLoading } = useCampaigns();
  const { deleteCampaign, campaignAction, startCycle } = useMutate();
  const confirm = useConfirm();
  const [extending, setExtending] = useState<MoqCampaign | null>(null);
  const busy = campaignAction.isPending || deleteCampaign.isPending || startCycle.isPending;

  const handleCancel = async (c: MoqCampaign) => {
    const ok = await confirm({
      title: `Cancel "${c.name}"?`,
      message: 'This refunds all commitments and closes the campaign. This cannot be undone.',
      confirmLabel: 'Cancel campaign',
      cancelLabel: 'Keep campaign',
    });
    if (ok) campaignAction.mutate({ id: c.id, action: 'cancel' });
  };

  // Ending one batch. Confirmed, because customers are committed to it — but
  // deliberately not worded as a warning: the commitments travel with the batch
  // that took them, and the successor opens in the same breath.
  const handleRoll = async (c: MoqCampaign) => {
    const ok = await confirm({
      title: `End batch #${c.batchNo} of "${c.name}"?`,
      message: `It closes with ${c.committed} kit${c.committed === 1 ? '' : 's'} and batch #${c.batchNo + 1} opens straight away, taking new commitments. Customer orders are not changed — settle those on the orders screen.`,
      confirmLabel: 'End batch & start next',
      cancelLabel: 'Keep it running',
    });
    if (ok) campaignAction.mutate({ id: c.id, action: 'roll' });
  };

  // Ending every running batch at once — the start of a new trading cycle.
  const handleStartCycle = async () => {
    const ok = await confirm({
      title: `Start a new cycle across ${running.length} batch${running.length === 1 ? '' : 'es'}?`,
      message: 'Every batch with commitments closes and its next batch opens in its place. Batches nobody has joined stay open. Customer orders are not changed.',
      confirmLabel: 'End all & start next',
      cancelLabel: 'Keep the board as it is',
    });
    if (ok) startCycle.mutate();
  };

  const handleDelete = async (c: MoqCampaign) => {
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      message: 'This permanently removes the campaign. This cannot be undone.',
      confirmLabel: 'Delete campaign',
    });
    if (ok) deleteCampaign.mutate(c.id);
  };

  const actions: CampaignActions = {
    edit: (c) => router.push(`/admin/group-buy/campaigns/${c.id}`),
    participants: (c) => router.push(`/admin/group-buy/campaigns/${c.id}/participants`),
    approve: (c) => campaignAction.mutate({ id: c.id, action: 'approve' }),
    roll: handleRoll,
    extend: (c) => setExtending(c),
    cancel: handleCancel,
    remove: handleDelete,
  };

  const groups = groupBySeries(campaigns);
  // Nothing running means nothing to end, so the cycle control stays off the
  // board rather than sitting there as a no-op.
  const running = campaigns.filter((c) => c.status === 'open');

  return (
    <div className="flex flex-col gap-4 pb-10">
      <Breadcrumb trail={[
        { label: 'Admin', href: '/admin' },
        { label: 'Group Buy', href: '/admin/group-buy' },
        { label: 'Campaigns' },
      ]} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-[24px] font-bold">Campaigns</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Group buys with a minimum order quantity. Approve, extend, or cancel — finished batches keep their history under each card.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-none">
          {running.length > 0 && (
            <button
              onClick={handleStartCycle}
              disabled={busy}
              className={btnBoardAction}
            >
              Start new cycle
            </button>
          )}
          <button className={btnPrimary} onClick={() => router.push('/admin/group-buy/campaigns/new')}>
            + Create Campaign
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-[16px] bg-white p-8 text-center shadow-card">
          <div className="mb-2 text-4xl">🎯</div>
          <div className="mb-1 font-bold text-ink">No campaigns yet</div>
          <div className="text-[13px] text-ink-muted">Create one to open a group buy batch.</div>
        </div>
      ) : (
        // Breakpoints are one step up from the usual md/lg pair because the
        // admin sidebar eats 14rem before the board gets any width: three
        // columns at 1024px leave a card too narrow for two buttons abreast.
        <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <SeriesGroup key={g.seriesId} group={g} busy={busy} actions={actions} />
          ))}
        </div>
      )}

      {extending && <ExtendModal campaign={extending} onClose={() => setExtending(null)} />}
    </div>
  );
}
