'use client';
// Admin → Group Buy → Campaigns.
//
// The board keeps the lifecycle actions that act on a whole campaign — approve,
// extend, cancel, delete — and hands creating and editing to their own routes.
// Each card names its buttons after its campaign so "Edit" on a board of eight
// batches is unambiguous to anyone not looking at the screen.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCampaigns, useMutate } from '@/lib/admin-api';
import { useConfirm } from '@/components/ConfirmDialog';
import { btnPrimary } from '@/components/admin-ui';
import { php } from '@/lib/format';
import { Breadcrumb } from '../Breadcrumb';
import { ExtendModal } from './ExtendModal';
import type { MoqCampaign } from '@/lib/types';

const OUTCOME_LABEL: Record<MoqCampaign['outcome'], string> = {
  awaiting_moq: 'Awaiting MOQ', processing: 'Processing', refunded: 'Refunded',
};

const STATUS_STYLE: Record<MoqCampaign['status'], string> = {
  // Written but not yet on the board — it opens on its own when opensAt passes.
  scheduled: 'bg-[#f5eddb] text-brand-navy',
  open: 'bg-[#e8f5db] text-brand-greendark',
  approved: 'bg-[#dbe8f5] text-brand-blue',
  // Reached its kit cap and closed itself; its successor is already open.
  completed: 'bg-[#dbe8f5] text-brand-navy',
  cancelled: 'bg-line text-ink-body',
};

const cardAction = 'flex-1 rounded-[9px] border border-line py-1.5 text-[13px] font-semibold disabled:opacity-50';

export default function AdminCampaignsPage() {
  const router = useRouter();
  const { data: campaigns = [], isLoading } = useCampaigns();
  const { deleteCampaign, campaignAction } = useMutate();
  const confirm = useConfirm();
  const [extending, setExtending] = useState<MoqCampaign | null>(null);
  const busy = campaignAction.isPending || deleteCampaign.isPending;

  const handleCancel = async (c: MoqCampaign) => {
    const ok = await confirm({
      title: `Cancel "${c.name}"?`,
      message: 'This refunds all commitments and closes the campaign. This cannot be undone.',
      confirmLabel: 'Cancel campaign',
      cancelLabel: 'Keep campaign',
    });
    if (ok) campaignAction.mutate({ id: c.id, action: 'cancel' });
  };

  const handleDelete = async (c: MoqCampaign) => {
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      message: 'This permanently removes the campaign. This cannot be undone.',
      confirmLabel: 'Delete campaign',
    });
    if (ok) deleteCampaign.mutate(c.id);
  };

  return (
    <div className="flex flex-col gap-4 pb-10">
      <Breadcrumb trail={[
        { label: 'Admin', href: '/admin' },
        { label: 'Group Buy', href: '/admin/group-buy' },
        { label: 'Campaigns' },
      ]} />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Campaigns</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Group buys with a minimum order quantity. Approve, extend, or cancel.</p>
        </div>
        <button className={btnPrimary} onClick={() => router.push('/admin/group-buy/campaigns/new')}>
          + Create Campaign
        </button>
      </div>

      {isLoading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-[16px] bg-white p-8 text-center shadow-card">
          <div className="mb-2 text-4xl">🎯</div>
          <div className="mb-1 font-bold text-ink-body">No campaigns yet</div>
          <div className="text-[13px] text-ink-muted">Create one to open a group buy batch.</div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const pct = Math.round(c.progress * 100);
            return (
              <article key={c.id} data-testid={`campaign-${c.id}`} className="rounded-[16px] bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-ink">{c.name} <span className="text-ink-muted">· Batch #{c.batchNo}</span></div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                </div>
                <div className="mt-1 text-[12px] text-ink-muted">{php(c.pricePerKitPhp)}/kit · {OUTCOME_LABEL[c.outcome]}</div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf2ea]">
                  <div className="h-full bg-gradient-to-r from-brand-blue to-brand-green" style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <div className="mt-1 text-[12px] font-semibold text-brand-greendark">
                  {c.committed}/{c.capacity} kits{c.full ? ' · batch full' : ` · ${c.remaining} slot${c.remaining === 1 ? '' : 's'} left`}
                </div>
                {c.deadline && <div className="mt-1 text-[11px] text-ink-muted">Deadline: {new Date(c.deadline).toLocaleString()}</div>}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => router.push(`/admin/group-buy/campaigns/${c.id}`)}
                    aria-label={`Edit ${c.name}`} className={`${cardAction} text-brand-blue`} disabled={busy}>Edit</button>
                  {c.status === 'open' && <>
                    <button onClick={() => campaignAction.mutate({ id: c.id, action: 'approve' })}
                      aria-label={`Approve ${c.name}`} className={`${cardAction} text-brand-greendark`} disabled={busy}>Approve</button>
                    <button onClick={() => setExtending(c)}
                      aria-label={`Extend ${c.name}`} className={`${cardAction} text-ink-body`} disabled={busy}>Extend</button>
                  </>}
                  {/* A full batch needs no approval and takes no extension, but a
                      supplier can still fall through after it closed — so cancel
                      stays available on a completed batch. */}
                  {(c.status === 'open' || c.status === 'completed') && (
                    <button onClick={() => handleCancel(c)}
                      aria-label={`Cancel ${c.name}`} className={`${cardAction} text-warn-fg`} disabled={busy}>Cancel</button>
                  )}
                  <button onClick={() => handleDelete(c)} aria-label={`Delete ${c.name}`}
                    className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] font-semibold text-[#b23b3b] disabled:opacity-50" disabled={busy}>✕</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {extending && <ExtendModal campaign={extending} onClose={() => setExtending(null)} />}
    </div>
  );
}
