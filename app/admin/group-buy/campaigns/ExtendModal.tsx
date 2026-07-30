'use client';
// Pushing a campaign's deadline out. A lifecycle action, so it belongs to the
// list beside approve and cancel rather than to the edit form — the form writes
// campaign fields, /campaigns/:id/action owns the state machine.
import { useState } from 'react';
import { Modal, field, label, btnPrimary, btnGhost } from '@/components/admin-ui';
import { useMutate } from '@/lib/admin-api';
import type { MoqCampaign } from '@/lib/types';

const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (local: string): string | null => (local ? new Date(local).toISOString() : null);

export function ExtendModal({ campaign, onClose }: { campaign: MoqCampaign; onClose: () => void }) {
  const { campaignAction } = useMutate();
  const [deadline, setDeadline] = useState(toLocalInput(campaign.deadline));
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await campaignAction.mutateAsync({ id: campaign.id, action: 'extend', deadline: toIso(deadline) });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not extend the campaign.');
    }
  };

  return (
    <Modal title={`Extend "${campaign.name}"`} onClose={onClose}>
      <label className="block">
        <span className={label}>New deadline</span>
        <input className={field} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </label>
      {error && <p role="alert" className="mt-3 rounded-[9px] bg-warn-bg px-3 py-2 text-[13px] font-semibold text-warn-fg">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={!deadline || campaignAction.isPending} onClick={submit}>
          {campaignAction.isPending ? 'Saving…' : 'Extend'}
        </button>
      </div>
    </Modal>
  );
}
