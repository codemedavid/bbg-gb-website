'use client';
// Create / Edit Campaign — the dedicated screen behind
// /admin/group-buy/campaigns/new and /admin/group-buy/campaigns/:id.
//
// This was a modal on the shared campaigns board. Giving it a route is what the
// client asked for, but it costs something the modal got for free: leaving no
// longer keeps the form mounted, so what was typed has to be kept deliberately.
// useCampaignDraft does that; the banner below tells the admin it happened.
//
// Scoped on purpose: this screen only ever writes moq_campaigns. It reads the
// product catalog to tick which products a campaign includes, and can do
// nothing else to it — no create, no edit, no archive.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminProducts, useMutate } from '@/lib/admin-api';
import { field, label, btnPrimary, btnGhost } from '@/components/admin-ui';
import { MOQ_BATCH_MAX_KITS } from '@/lib/pricing';
import {
  campaignPayloadFrom, validateCampaignDraft, type CampaignDraft,
} from '@/lib/campaign-form';
import { useCampaignDraft } from '@/lib/campaign-draft';
import { isChannelEnabled } from '@/lib/product-channels';
import type { IncludedProduct, MoqCampaign } from '@/lib/types';

const CAMPAIGNS_HREF = '/admin/group-buy/campaigns';

// ISO string → value for <input type="datetime-local">, which works in local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toIso = (local: string): string | null => (local ? new Date(local).toISOString() : null);

type Props = {
  /** The campaign's id, or 'new' while creating — also the draft's storage key. */
  draftId: string;
  initial: CampaignDraft;
};

export function CampaignForm({ draftId, initial }: Props) {
  const router = useRouter();
  const { saveCampaign } = useMutate();
  const { data: products = [] } = useAdminProducts();
  const { draft, setDraft, restored, discard, clear } = useCampaignDraft(draftId, initial);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(draft.id ?? initial.id);
  const included = draft.includedProducts;
  // Only products the admin enabled for Group Buy may be ticked. The route
  // refuses the rest anyway (lib/channel-guard.ts) — filtering here is so the
  // admin never picks one and reads the refusal afterwards. Already-included
  // products survive the filter: a campaign built before the channel was
  // switched off must still show what it carries, or editing its deadline would
  // silently empty it.
  const selectable = products.filter(
    (p) => isChannelEnabled(p, 'group_buy') || included.some((i) => i.productId === p.id),
  );
  const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => setDraft({ ...draft, [k]: v });

  const isIncluded = (id: string) => included.some((p) => p.productId === id);
  const toggleInclude = (id: string, name: string) =>
    set('includedProducts', isIncluded(id)
      ? included.filter((p) => p.productId !== id)
      : [...included, { productId: id, name, outOfStock: false } as IncludedProduct]);
  const toggleOos = (id: string) =>
    set('includedProducts', included.map((p) => (p.productId === id ? { ...p, outOfStock: !p.outOfStock } : p)));

  // An explicit destination, not router.back(). This screen is reached from the
  // list and from a deep link, and history would send those two somewhere
  // different — one of them out of the campaign workflow entirely.
  const goBack = () => router.push(CAMPAIGNS_HREF);

  const submit = async () => {
    const invalid = validateCampaignDraft(draft);
    if (invalid) { setError(invalid); return; }
    setError(null);
    try {
      await saveCampaign.mutateAsync(campaignPayloadFrom(draft));
      // The draft has become the record; the next visit must start from the
      // server's copy. Cleared only on success — a rejected save must not also
      // throw away the work it rejected.
      clear();
      router.push(CAMPAIGNS_HREF);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save campaign.');
    }
  };

  return (
    <div className="pb-10">
      <div className="mb-5 flex items-center gap-3">
        <button onClick={goBack} aria-label="Back to campaigns"
          className="rounded-[10px] border border-line px-3 py-2 text-[14px] font-semibold text-ink-body hover:bg-white">
          ← Back
        </button>
        <h1 className="m-0 font-display text-[22px] font-bold text-brand-navy">
          {isEdit ? 'Edit Campaign' : 'Create Campaign'}
        </h1>
      </div>

      {restored && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[10px] bg-surface-mist px-3 py-2.5 text-[13px] text-ink-body">
          <span>We kept your unsaved draft from earlier.</span>
          <button onClick={discard} className="shrink-0 font-semibold text-brand-blue underline">Discard draft</button>
        </div>
      )}

      <div className="rounded-[16px] bg-white p-5 shadow-card">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className={label}>Name</span>
            <input className={field} value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Price / kit ₱</span>
            <input className={field} type="number" value={draft.pricePerKitPhp}
              onChange={(e) => set('pricePerKitPhp', e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Packing fee ₱ (local shipping incl.)</span>
            <input className={field} type="number" value={draft.shippingPhp}
              onChange={(e) => set('shippingPhp', e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>{`Batch size (kits, max ${MOQ_BATCH_MAX_KITS})`}</span>
            <input className={field} type="number" min={1} max={MOQ_BATCH_MAX_KITS} value={draft.moq}
              onChange={(e) => set('moq', e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Opens at</span>
            <input className={field} type="datetime-local" value={toLocalInput(draft.opensAt)}
              onChange={(e) => set('opensAt', toIso(e.target.value))} />
            <span className="mt-0.5 block text-[12px] text-ink-muted">
              Leave blank to open now. A future date holds the batch off the board until then.
            </span>
          </label>
          <label className="block">
            <span className={label}>Deadline</span>
            <input className={field} type="datetime-local" value={toLocalInput(draft.deadline)}
              onChange={(e) => set('deadline', toIso(e.target.value))} />
          </label>
          <label className="block">
            <span className={label}>Arrival group</span>
            <select className={field} value={draft.arrivalGroup}
              onChange={(e) => set('arrivalGroup', e.target.value as MoqCampaign['arrivalGroup'])}>
              {(['white_powder', 'salt_liquid'] as const).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className={label}>Description</span>
            <textarea className={field} rows={2} value={draft.description}
              onChange={(e) => set('description', e.target.value)} />
          </label>
        </div>

        <div className="mt-5">
          <div className="mb-1 text-[12px] font-semibold text-ink-body">Included products</div>
          <div className="max-h-56 overflow-y-auto rounded-[10px] border border-line">
            {selectable.length === 0 ? (
              <div className="px-3 py-4 text-[13px] text-ink-muted">
                No products have the Group Buy channel switched on. Enable it in Product Management first.
              </div>
            ) : selectable.map((p) => {
              const on = isIncluded(p.id);
              const oos = included.find((i) => i.productId === p.id)?.outOfStock ?? false;
              return (
                <div key={p.id} className="flex items-center gap-2.5 border-b border-line px-3 py-2 text-[13px] last:border-0">
                  <label className="flex flex-1 items-center gap-2.5 truncate">
                    <input type="checkbox" checked={on} onChange={() => toggleInclude(p.id, p.name)} />
                    <span className="flex-1 truncate text-ink-body">{p.name}</span>
                  </label>
                  {on && (
                    <button type="button" onClick={() => toggleOos(p.id)} aria-label={`Mark ${p.name} ${oos ? 'in stock' : 'out of stock'}`}
                      className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${oos ? 'bg-warn-bg text-warn-fg' : 'bg-[#e8f5db] text-brand-greendark'}`}>
                      {oos ? 'Out of stock' : 'In stock'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {error && <p role="alert" className="mt-4 rounded-[9px] bg-warn-bg px-3 py-2 text-[13px] font-semibold text-warn-fg">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button className={btnGhost} onClick={goBack}>Cancel</button>
          <button className={btnPrimary} disabled={saveCampaign.isPending} onClick={submit}>
            {saveCampaign.isPending ? 'Saving…' : 'Save campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}
