'use client';
import { useState } from 'react';
import { useCampaigns, useAdminProducts, useMutate } from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import { php } from '@/lib/format';
import type { CampaignPayload, IncludedProduct, MoqCampaign } from '@/lib/types';

type Draft = Partial<MoqCampaign>;

const blank = (): Draft => ({
  name: '', pricePerKitPhp: '0', moq: 10, perCustomerMin: 1, shippingPhp: '300',
  status: 'open', deadline: null, includedProducts: [], arrivalGroup: 'white_powder', description: null,
});

const OUTCOME_LABEL: Record<MoqCampaign['outcome'], string> = {
  awaiting_moq: 'Awaiting MOQ', processing: 'Processing', refunded: 'Refunded',
};

// ISO string → value for <input type="datetime-local"> in local time.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toIso = (local: string): string | null => (local ? new Date(local).toISOString() : null);

// Empty numeric inputs come through as '' → Number('') is 0, which would silently
// write a ₱0 price or trip the schema's positive() guards. Validate against the same
// bounds the API enforces before building the payload.
function validate(f: Draft): string | null {
  if ((f.name ?? '').trim().length < 2) return 'Name must be at least 2 characters.';
  if (!(Number(f.pricePerKitPhp) > 0)) return 'Price / kit must be greater than 0.';
  if (!Number.isInteger(Number(f.moq)) || Number(f.moq) < 1) return 'MOQ must be a whole number of 1 or more.';
  if (!Number.isInteger(Number(f.perCustomerMin)) || Number(f.perCustomerMin) < 1) return 'Min / customer must be 1 or more.';
  if (Number(f.shippingPhp) < 0) return 'Shipping cannot be negative.';
  return null;
}

function CampaignForm({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { saveCampaign } = useMutate();
  const { data: products = [] } = useAdminProducts();
  const [f, setF] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const included = f.includedProducts ?? [];

  const isIncluded = (id: string) => included.some((p) => p.productId === id);
  const toggleInclude = (id: string, name: string) =>
    setF({
      ...f,
      includedProducts: isIncluded(id)
        ? included.filter((p) => p.productId !== id)
        : [...included, { productId: id, name, outOfStock: false } as IncludedProduct],
    });
  const toggleOos = (id: string) =>
    setF({ ...f, includedProducts: included.map((p) => (p.productId === id ? { ...p, outOfStock: !p.outOfStock } : p)) });

  const submit = async () => {
    const invalid = validate(f);
    if (invalid) { setError(invalid); return; }
    setError(null);
    const payload: CampaignPayload = {
      id: f.id,
      name: (f.name ?? '').trim(),
      pricePerKitPhp: Number(f.pricePerKitPhp),
      moq: Number(f.moq),
      perCustomerMin: Number(f.perCustomerMin),
      shippingPhp: Number(f.shippingPhp),
      deadline: f.deadline ?? null,
      includedProducts: included,
      arrivalGroup: f.arrivalGroup ?? 'white_powder',
      description: f.description ?? null,
    };
    try {
      await saveCampaign.mutateAsync(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save campaign.');
    }
  };

  return (
    <Modal title={f.id ? 'Edit campaign' : 'New campaign'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Labeled label="Name"><input className={field} value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Labeled></div>
        <Labeled label="Price / kit ₱"><input className={field} type="number" value={f.pricePerKitPhp as any} onChange={(e) => setF({ ...f, pricePerKitPhp: e.target.value })} /></Labeled>
        <Labeled label="Packing fee ₱ (local shipping incl.)"><input className={field} type="number" value={f.shippingPhp as any} onChange={(e) => setF({ ...f, shippingPhp: e.target.value })} /></Labeled>
        <Labeled label="MOQ (kits)"><input className={field} type="number" value={f.moq ?? 10} onChange={(e) => setF({ ...f, moq: Number(e.target.value) })} /></Labeled>
        <Labeled label="Min / customer"><input className={field} type="number" value={f.perCustomerMin ?? 1} onChange={(e) => setF({ ...f, perCustomerMin: Number(e.target.value) })} /></Labeled>
        <Labeled label="Deadline"><input className={field} type="datetime-local" value={toLocalInput(f.deadline)} onChange={(e) => setF({ ...f, deadline: toIso(e.target.value) })} /></Labeled>
        <Labeled label="Arrival group">
          <select className={field} value={f.arrivalGroup} onChange={(e) => setF({ ...f, arrivalGroup: e.target.value as MoqCampaign['arrivalGroup'] })}>
            {(['white_powder', 'salt_liquid'] as const).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Labeled>
        <div className="col-span-2"><Labeled label="Description"><textarea className={field} rows={2} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Labeled></div>
      </div>

      <div className="mt-4">
        <div className="mb-1 text-[12px] font-semibold text-ink-body">Included products</div>
        <div className="max-h-44 overflow-y-auto rounded-[10px] border border-line">
          {products.length === 0 ? (
            <div className="px-3 py-4 text-[13px] text-ink-muted">No products yet.</div>
          ) : products.map((p) => {
            const on = isIncluded(p.id);
            const oos = included.find((i) => i.productId === p.id)?.outOfStock ?? false;
            return (
              <label key={p.id} className="flex items-center gap-2.5 border-b border-line px-3 py-2 text-[13px] last:border-0">
                <input type="checkbox" checked={on} onChange={() => toggleInclude(p.id, p.name)} />
                <span className="flex-1 truncate text-ink-body">{p.name}</span>
                {on && (
                  <button type="button" onClick={() => toggleOos(p.id)}
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${oos ? 'bg-warn-bg text-warn-fg' : 'bg-[#e8f5db] text-brand-greendark'}`}>
                    {oos ? 'Out of stock' : 'In stock'}
                  </button>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {error && <div className="mt-4 rounded-[9px] bg-warn-bg px-3 py-2 text-[13px] font-semibold text-warn-fg">{error}</div>}

      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saveCampaign.isPending} onClick={submit}>{saveCampaign.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function ExtendModal({ campaign, onClose }: { campaign: MoqCampaign; onClose: () => void }) {
  const { campaignAction } = useMutate();
  const [deadline, setDeadline] = useState(toLocalInput(campaign.deadline));
  const submit = async () => {
    await campaignAction.mutateAsync({ id: campaign.id, action: 'extend', deadline: toIso(deadline) });
    onClose();
  };
  return (
    <Modal title={`Extend "${campaign.name}"`} onClose={onClose}>
      <Labeled label="New deadline"><input className={field} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Labeled>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={!deadline || campaignAction.isPending} onClick={submit}>{campaignAction.isPending ? 'Saving…' : 'Extend'}</button>
      </div>
    </Modal>
  );
}

const STATUS_STYLE: Record<MoqCampaign['status'], string> = {
  open: 'bg-[#e8f5db] text-brand-greendark',
  approved: 'bg-[#dbe8f5] text-brand-blue',
  cancelled: 'bg-line text-ink-body',
};

export default function AdminCampaignsPage() {
  const { data: campaigns = [], isLoading } = useCampaigns();
  const { deleteCampaign, campaignAction } = useMutate();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [extending, setExtending] = useState<MoqCampaign | null>(null);
  const busy = campaignAction.isPending || deleteCampaign.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">MOQ Campaigns</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Group buys with a minimum order quantity. Approve, extend, or cancel.</p>
        </div>
        <button className={btnPrimary} onClick={() => setEditing(blank())}>+ New campaign</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? <div className="text-ink-muted">Loading…</div> : campaigns.map((c) => {
          const pct = Math.round(c.progress * 100);
          return (
            <div key={c.id} className="rounded-[16px] bg-white p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="font-bold text-ink">{c.name}</div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[c.status]}`}>{c.status}</span>
              </div>
              <div className="mt-1 text-[12px] text-ink-muted">{php(c.pricePerKitPhp)}/kit · {OUTCOME_LABEL[c.outcome]}</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf2ea]"><div className="h-full bg-gradient-to-r from-brand-blue to-brand-green" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
              <div className="mt-1 text-[12px] font-semibold text-brand-greendark">{c.committed}/{c.moq} kits{c.reached ? ' · MOQ reached' : ` · ${c.remaining} to go`}</div>
              {c.deadline && <div className="mt-1 text-[11px] text-ink-muted">Deadline: {new Date(c.deadline).toLocaleString()}</div>}

              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setEditing(c)} className="flex-1 rounded-[9px] border border-line py-1.5 text-[13px] font-semibold text-brand-blue disabled:opacity-50" disabled={busy}>Edit</button>
                {c.status === 'open' && <>
                  <button onClick={() => campaignAction.mutate({ id: c.id, action: 'approve' })} className="flex-1 rounded-[9px] border border-line py-1.5 text-[13px] font-semibold text-brand-greendark disabled:opacity-50" disabled={busy}>Approve</button>
                  <button onClick={() => setExtending(c)} className="flex-1 rounded-[9px] border border-line py-1.5 text-[13px] font-semibold text-ink-body disabled:opacity-50" disabled={busy}>Extend</button>
                  <button onClick={() => confirm(`Cancel "${c.name}"? This refunds all commitments.`) && campaignAction.mutate({ id: c.id, action: 'cancel' })} className="flex-1 rounded-[9px] border border-line py-1.5 text-[13px] font-semibold text-warn-fg disabled:opacity-50" disabled={busy}>Cancel</button>
                </>}
                <button onClick={() => confirm(`Delete "${c.name}"?`) && deleteCampaign.mutate(c.id)} className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] font-semibold text-[#b23b3b] disabled:opacity-50" disabled={busy}>✕</button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && <CampaignForm initial={editing} onClose={() => setEditing(null)} />}
      {extending && <ExtendModal campaign={extending} onClose={() => setExtending(null)} />}
    </div>
  );
}
