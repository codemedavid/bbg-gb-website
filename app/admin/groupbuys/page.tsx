'use client';
import { useState } from 'react';
import { useAdminGroupBuys, useMutate } from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { php } from '@/lib/format';
import { KAHATI_MAX_VIALS, kahatiProgressPercent } from '@/lib/kahati';
import type { GroupBuy } from '@/lib/types';

// A brand-new hatian starts empty and fills exactly one kit.
const blank = (): Partial<GroupBuy> => ({ name: '', pricePerKitPhp: '0', totalSlots: KAHATI_MAX_VIALS, claimedSlots: 0, minVials: 1, repackFeePhp: '150', status: 'open', arrivalGroup: 'white_powder' });

function GroupBuyForm({ initial, onClose }: { initial: Partial<GroupBuy>; onClose: () => void }) {
  const { saveGroupBuy } = useMutate();
  const [f, setF] = useState<Partial<GroupBuy>>(initial);
  // A rejected save (over-cap counts, cap below claimed vials, …) must show its
  // reason here in the form — closing, or failing silently, would leave the
  // admin thinking the save worked or the button was broken.
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      await saveGroupBuy.mutateAsync({
        id: f.id, name: f.name, pricePerKitPhp: Number(f.pricePerKitPhp) as any,
        totalSlots: Number(f.totalSlots), claimedSlots: Number(f.claimedSlots), minVials: Number(f.minVials),
        repackFeePhp: Number(f.repackFeePhp) as any, status: f.status, arrivalGroup: f.arrivalGroup,
        description: f.description ?? null,
      } as any);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save group buy.');
    }
  };
  return (
    <Modal title={f.id ? 'Edit group buy' : 'New group buy'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Labeled label="Name"><input className={field} value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Labeled></div>
        <Labeled label="Price / kit ₱ (editable)"><input className={field} type="number" value={f.pricePerKitPhp as any} onChange={(e) => setF({ ...f, pricePerKitPhp: e.target.value })} /></Labeled>
        <Labeled label="Packing fee ₱ (local shipping incl.)"><input className={field} type="number" value={f.repackFeePhp as any} onChange={(e) => setF({ ...f, repackFeePhp: e.target.value })} /></Labeled>
        <Labeled label={`Vial cap (1 kit = ${KAHATI_MAX_VIALS})`}><input className={field} type="number" min={1} max={KAHATI_MAX_VIALS} value={f.totalSlots ?? KAHATI_MAX_VIALS} onChange={(e) => setF({ ...f, totalSlots: Number(e.target.value) })} /></Labeled>
        <Labeled label="Claimed vials"><input className={field} type="number" min={0} max={KAHATI_MAX_VIALS} value={f.claimedSlots ?? 0} onChange={(e) => setF({ ...f, claimedSlots: Number(e.target.value) })} /></Labeled>
        <Labeled label="Min vials / person"><input className={field} type="number" min={1} max={KAHATI_MAX_VIALS} value={f.minVials ?? 1} onChange={(e) => setF({ ...f, minVials: Number(e.target.value) })} /></Labeled>
        <Labeled label="Status">
          <select className={field} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as any })}>
            {['open', 'closed', 'shipped', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Labeled>
      </div>
      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saveGroupBuy.isPending} onClick={submit}>{saveGroupBuy.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

export default function AdminGroupBuysPage() {
  const { data: gbs = [], isLoading } = useAdminGroupBuys();
  const { deleteGroupBuy, saveGroupBuy } = useMutate();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<GroupBuy> | null>(null);

  const handleDelete = async (g: GroupBuy) => {
    const ok = await confirm({
      title: `Delete "${g.name}"?`,
      message: 'This permanently removes the group buy. This cannot be undone.',
      confirmLabel: 'Delete group buy',
    });
    if (ok) deleteGroupBuy.mutate(g.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Group Buys</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Edit kahati prices, slots &amp; close orders.</p>
        </div>
        <button className={btnPrimary} onClick={() => setEditing(blank())}>+ New group buy</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? <div className="text-ink-muted">Loading…</div> : gbs.map((g) => {
          const progress = kahatiProgressPercent(g.claimedSlots, g.totalSlots);
          return (
            <div key={g.id} className="rounded-[16px] bg-white p-4 shadow-card">
              <div className="flex items-start justify-between">
                <div className="font-bold text-ink">{g.name}</div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${g.status === 'open' ? 'bg-[#e8f5db] text-brand-greendark' : g.status === 'cancelled' ? 'bg-[#fbe4e4] text-[#b23b3b]' : 'bg-line text-ink-body'}`}>{g.status}</span>
              </div>
              <div className="mt-1 text-[12px] text-ink-muted">{php(g.pricePerKitPhp)}/kit · ₱{Number(g.pricePerKitPhp) / 10}/vial</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf2ea]"><div className="h-full bg-gradient-to-r from-brand-blue to-brand-green" style={{ width: `${progress}%` }} /></div>
              <div className="mt-1 text-[12px] font-semibold text-brand-greendark">{g.claimedSlots}/{g.totalSlots} vials</div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setEditing(g)} className="flex-1 rounded-[9px] border border-line py-1.5 text-[13px] font-semibold text-brand-blue">Edit</button>
                {g.status === 'open' && <button onClick={() => saveGroupBuy.mutate({ id: g.id, status: 'closed' } as any)} className="flex-1 rounded-[9px] border border-line py-1.5 text-[13px] font-semibold text-warn-fg">Close</button>}
                <button onClick={() => handleDelete(g)} className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] font-semibold text-[#b23b3b]">✕</button>
              </div>
            </div>
          );
        })}
      </div>
      {editing && <GroupBuyForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
