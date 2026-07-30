'use client';
import { useState } from 'react';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import { MOQ_BATCH_MAX_KITS } from '@/lib/pricing';
import type { IncludedProduct, Product } from '@/lib/types';

// The group buy terms of one product inside one campaign.
//
// The campaign form used to say nothing about a product beyond "included" —
// every product in a campaign was sold at the campaign's single price with the
// campaign's single minimum. An admin who wanted different terms per product
// had to make a second campaign. This modal is where those terms are set.
//
// Terms are seeded from the product's own saved Group Buy settings and then
// belong to the campaign: editing them here never writes back to the catalog,
// and editing the catalog later never moves a campaign customers have already
// joined. That snapshot is the same promise openSuccessor keeps when it copies
// these entries into batch #2.

// Every field is a string while it is being typed: '' is a field the admin
// cleared, which must stay absent from the entry rather than becoming 0.
type Draft = {
  pricePerKitPhp: string;
  pricePerPiecePhp: string;
  minOrderQty: string;
  maxBatchKits: string;
  vialsPerKit: string;
  outOfStock: boolean;
};

const str = (n: number | string | null | undefined): string => (n == null ? '' : String(Number(n)));

// What the modal opens with: the campaign's own terms if this product is
// already included, otherwise the product's saved defaults.
export function draftFor(product: Product, entry: IncludedProduct | null): Draft {
  return {
    pricePerKitPhp: str(entry?.pricePerKitPhp ?? product.groupBuyKitPhp),
    pricePerPiecePhp: str(entry?.pricePerPiecePhp ?? product.groupBuyPiecePhp),
    minOrderQty: str(entry?.minOrderQty ?? product.groupBuyMinOrder),
    maxBatchKits: str(entry?.maxBatchKits ?? product.groupBuyMaxBatch),
    vialsPerKit: str(entry?.vialsPerKit ?? product.vialsPerKit),
    outOfStock: entry?.outOfStock ?? false,
  };
}

// Mirrors the bounds includedProductSchema enforces, so an admin reads the
// reason here instead of watching the campaign save fail later.
export function validateDraft(d: Draft): string | null {
  const money = (v: string, what: string) =>
    v !== '' && !(Number(v) >= 0) ? `${what} cannot be negative.` : null;
  const kits = (v: string, what: string) =>
    v !== '' && (!Number.isInteger(Number(v)) || Number(v) < 1) ? `${what} must be a whole number of 1 or more.` : null;

  return (
    money(d.pricePerKitPhp, 'Group Buy price / kit') ??
    money(d.pricePerPiecePhp, 'Group Buy price / piece') ??
    kits(d.minOrderQty, 'Minimum order') ??
    kits(d.maxBatchKits, 'Maximum batch size') ??
    (d.maxBatchKits !== '' && Number(d.maxBatchKits) > MOQ_BATCH_MAX_KITS
      ? `A batch holds at most ${MOQ_BATCH_MAX_KITS} kits — bigger runs continue as batch #2.`
      : null) ??
    kits(d.vialsPerKit, 'Vials per kit')
  );
}

// A cleared field is dropped rather than sent as 0: absent means "the product's
// own setting stands", and 0 is a price, not an absence.
export function entryFrom(product: Product, d: Draft): IncludedProduct {
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const terms = {
    pricePerKitPhp: num(d.pricePerKitPhp),
    pricePerPiecePhp: num(d.pricePerPiecePhp),
    minOrderQty: num(d.minOrderQty),
    maxBatchKits: num(d.maxBatchKits),
    vialsPerKit: num(d.vialsPerKit),
  };
  const set = Object.fromEntries(Object.entries(terms).filter(([, v]) => v !== undefined));
  return { productId: product.id, name: product.name, outOfStock: d.outOfStock, ...set };
}

type Props = {
  product: Product;
  // The entry this campaign already holds for the product, or null when the
  // admin is adding it.
  entry: IncludedProduct | null;
  onSave: (entry: IncludedProduct) => void;
  onRemove: () => void;
  onClose: () => void;
};

export function CampaignProductQuickEdit({ product, entry, onSave, onRemove, onClose }: Props) {
  const [d, setD] = useState<Draft>(() => draftFor(product, entry));
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft) => (v: string | boolean) => setD((prev) => ({ ...prev, [k]: v }));

  const submit = () => {
    const invalid = validateDraft(d);
    // Staying open with the reason on screen: closing on a rejected save reads
    // as "saved" and the admin finds out at checkout.
    if (invalid) { setError(invalid); return; }
    setError(null);
    onSave(entryFrom(product, d));
  };

  const numberField = (label: string, key: keyof Draft, extra: Record<string, number> = {}) => (
    <Labeled label={label}>
      <input className={field} type="number" value={d[key] as string} {...extra}
        onChange={(e) => set(key)(e.target.value)} />
    </Labeled>
  );

  return (
    <Modal title={`Quick edit — ${product.name}`} onClose={onClose}>
      <p className="mb-3 text-[12px] leading-snug text-ink-muted">
        Seeded from this product&rsquo;s saved Group Buy settings. Anything changed here applies to
        this campaign only. Leave a field blank to keep the product&rsquo;s own setting.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {numberField('Group Buy price / kit ₱', 'pricePerKitPhp', { min: 0 })}
        {numberField('Group Buy price / piece ₱', 'pricePerPiecePhp', { min: 0 })}
        {numberField('Minimum order (kits)', 'minOrderQty', { min: 1 })}
        {numberField('Maximum batch size (kits)', 'maxBatchKits', { min: 1, max: MOQ_BATCH_MAX_KITS })}
        {numberField('Vials per kit', 'vialsPerKit', { min: 1 })}
      </div>

      {/* The minimum and the batch size are the terms agreed for this product.
          Checkout still counts kits per campaign — the orders route enforces the
          campaign's own per-customer minimum — so say so rather than let an
          admin believe this figure gates a commitment. */}
      <p className="mt-3 rounded-[10px] bg-surface-mist px-3 py-2 text-[11.5px] leading-snug text-ink-body">
        Checkout enforces the campaign-wide minimum and batch size; these per-product figures record
        what was agreed for this item.
      </p>

      <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-ink-body">
        <input type="checkbox" checked={d.outOfStock} onChange={(e) => set('outOfStock')(e.target.checked)} />
        Out of stock for this campaign
      </label>

      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        {entry && (
          <button className="mr-auto rounded-[10px] border border-line px-4 py-2.5 text-[14px] font-semibold text-[#b23b3b] hover:bg-[#fdeaea]"
            onClick={onRemove}>
            Remove from campaign
          </button>
        )}
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} onClick={submit}>{entry ? 'Save changes' : 'Add to campaign'}</button>
      </div>
    </Modal>
  );
}
