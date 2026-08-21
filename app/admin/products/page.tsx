'use client';
import { useState } from 'react';
import { useAdminProducts, useAdminCategories, useMutate } from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { php } from '@/lib/format';
import { KAHATI_MAX_VIALS } from '@/lib/pricing';
import { SALES_CHANNELS, CHANNEL_LABELS, CHANNEL_FIELD } from '@/lib/product-channels';
import type { Product } from '@/lib/types';

// What each channel actually means for the customer, in one line. The three
// names alone do not say that Kahati splits a kit per vial while Group Buy
// pools whole ones — which is the distinction the admin is deciding on.
const CHANNEL_HINT =
  'On-Hand sells ready stock from the shop. Group Buy pools whole kits in a campaign batch. '
  + 'Kahati splits one kit between buyers, so leave it off for anything not sold per vial.';

// The bundle the shop quotes on the shelf. Ten vials happens to be a kit's
// worth, but the two are priced independently — this is a rate, not a kit.
const ON_HAND_BUNDLE_VIALS = 10;

const blank = (): Partial<Product> => ({
  name: '', spec: '', pricePhp: '0', arrivalGroup: 'white_powder', isOnHand: false,
  stock: 0, imageEmoji: '💧', isActive: true,
  // A batch of one kit — the client's stated default and the largest a hatian
  // can hold. Everything else starts unset, meaning "no figure of its own".
  isGroupBuy: false, isKahati: false, gbMaxVialsPerBatch: KAHATI_MAX_VIALS,
});

// The minimum and the batch cap are only ever on screen together here, so this
// is the one place the contradiction can be shown to the person who typed it.
// Downstream, kahatiDefaultsFor clamps a minimum above the cap so the counter
// stays joinable — right for a legacy row, but it would silently discard what
// the admin just entered.
function groupBuyError(f: Partial<Product>): string | null {
  // Either board channel seeds itself from these figures, so either one makes
  // the contradiction reachable.
  if (!f.isGroupBuy && !f.isKahati) return null;
  const { gbMinVials: min, gbMaxVialsPerBatch: max } = f;
  if (min != null && max != null && min > max) {
    return `Minimum order (${min} vials) cannot exceed the maximum batch of ${max} vials.`;
  }
  return null;
}

function ProductForm({ initial, onClose }: { initial: Partial<Product>; onClose: () => void }) {
  const { data: cats = [] } = useAdminCategories();
  const { saveProduct } = useMutate();
  const [f, setF] = useState<Partial<Product>>(initial);
  const num = (v: string) => (v === '' ? null : Number(v));
  // A rejected save must show its reason here in the form — silently keeping
  // the modal open reads as a broken Save button.
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const invalid = groupBuyError(f);
    if (invalid) { setError(invalid); return; }
    try {
      await saveProduct.mutateAsync({
        id: f.id,
        name: f.name, spec: f.spec, categoryId: f.categoryId ?? null,
        pricePhp: Number(f.pricePhp) as any, priceUsd: (f.priceUsd != null ? Number(f.priceUsd) : null) as any,
        isOnHand: f.isOnHand, onHandKitPhp: (f.onHandKitPhp != null ? Number(f.onHandKitPhp) : null) as any,
        onHandPiecePhp: (f.onHandPiecePhp != null ? Number(f.onHandPiecePhp) : null) as any,
        onHandTenVialPhp: (f.onHandTenVialPhp != null ? Number(f.onHandTenVialPhp) : null) as any,
        stock: f.stock, kitSize: f.kitSize, arrivalGroup: f.arrivalGroup, imageEmoji: f.imageEmoji, description: f.description ?? null,
        // Sent whether or not the product is currently offered this way:
        // isGroupBuy is the switch, and keeping the figures means an admin who
        // toggles it off and on again does not retype the terms.
        isGroupBuy: f.isGroupBuy ?? false,
        isKahati: f.isKahati ?? false,
        gbPricePerKitPhp: (f.gbPricePerKitPhp != null && f.gbPricePerKitPhp !== '' ? Number(f.gbPricePerKitPhp) : null) as any,
        gbPricePerPiecePhp: (f.gbPricePerPiecePhp != null && f.gbPricePerPiecePhp !== '' ? Number(f.gbPricePerPiecePhp) : null) as any,
        gbVialsPerKit: f.gbVialsPerKit ?? null, gbMinVials: f.gbMinVials ?? null,
        gbMaxVialsPerBatch: f.gbMaxVialsPerBatch ?? null,
      } as any);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save product.');
    }
  };

  return (
    <Modal title={f.id ? 'Edit product' : 'New product'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Name"><input className={field} value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Labeled>
        <Labeled label="Spec (e.g. 15mg vial)"><input className={field} value={f.spec || ''} onChange={(e) => setF({ ...f, spec: e.target.value })} /></Labeled>
        <Labeled label="Category">
          <select className={field} value={f.categoryId || ''} onChange={(e) => setF({ ...f, categoryId: e.target.value || null })}>
            <option value="">—</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Labeled>
        <Labeled label="Arrival group">
          <select className={field} value={f.arrivalGroup} onChange={(e) => setF({ ...f, arrivalGroup: e.target.value as any })}>
            <option value="white_powder">White powder (ships first)</option>
            <option value="salt_liquid">Salt / liquid (3–5 days later)</option>
          </select>
        </Labeled>
        <Labeled label="Price ₱"><input className={field} type="number" value={f.pricePhp as any} onChange={(e) => setF({ ...f, pricePhp: e.target.value })} /></Labeled>
        <Labeled label="Stock"><input className={field} type="number" value={f.stock ?? 0} onChange={(e) => setF({ ...f, stock: Number(e.target.value) })} /></Labeled>
        {/* Drives the weekly report's Kits column: 10 vials to a peptide kit, 1 for anything sold per piece. */}
        {/* How the SUPPLIER ships this product — the divisor behind the weekly
            report's Kits column. Distinct from the group buy's "Vials per kit"
            below, which is how a batch is split among buyers. Deliberately
            worded so the two cannot be confused on screen or in a test query. */}
        <Labeled label="Supplier kit size (vials)"><input className={field} type="number" min={1} value={f.kitSize ?? 10} onChange={(e) => setF({ ...f, kitSize: Number(e.target.value) })} /></Labeled>
      </div>

      {/* Sales Channels — the shop sells the same catalogue three ways, and the
          admin decides per product which of them may carry it. Grouped into one
          labelled block rather than left as checkboxes scattered between the
          pricing fields: they are one decision with three parts, and reading
          them together is how you see that a product is Group Buy but not
          Kahati. Enforced server-side too (lib/product-channels.ts) — this
          section is where the decision is made, not where it is kept. */}
      <fieldset className="mt-4 rounded-[12px] border border-line-soft bg-[#fbfbfa] px-3.5 pb-3.5 pt-2.5">
        <legend className="px-1.5 text-[13px] font-bold text-ink">Sales Channels</legend>
        <p className="text-[12px] leading-snug text-ink-muted">
          Select which sales channels this product can be offered through.
        </p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
          {SALES_CHANNELS.map((channel) => (
            <label
              key={channel}
              className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-line-soft bg-white px-3 py-2.5 text-[13px] font-semibold text-ink-body transition-colors hover:border-brand-blue has-[:checked]:border-brand-blue has-[:checked]:bg-[#eef4ff]"
            >
              <input
                type="checkbox"
                checked={!!f[CHANNEL_FIELD[channel]]}
                onChange={(e) => setF({ ...f, [CHANNEL_FIELD[channel]]: e.target.checked })}
              />
              {CHANNEL_LABELS[channel]}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-snug text-ink-muted">
          {CHANNEL_HINT}
        </p>
      </fieldset>

      {f.isOnHand && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Labeled label="On-hand price / kit ₱"><input className={field} type="number" value={(f.onHandKitPhp as any) ?? ''} onChange={(e) => setF({ ...f, onHandKitPhp: num(e.target.value) as any })} /></Labeled>
            <Labeled label="On-hand price / piece ₱"><input className={field} type="number" value={(f.onHandPiecePhp as any) ?? ''} onChange={(e) => setF({ ...f, onHandPiecePhp: num(e.target.value) as any })} /></Labeled>
            {/* The bulk rate for ten vials, stated rather than inferred: the two
                prices above only ever implied it, and the shop quotes ten at a
                rate of its own. Blank means the product has no bundle rate —
                never ₱0, which would read as ten free vials. */}
            <Labeled label={`On-hand price / ${ON_HAND_BUNDLE_VIALS} vials ₱`}><input className={field} type="number" min={0} value={(f.onHandTenVialPhp as any) ?? ''} onChange={(e) => setF({ ...f, onHandTenVialPhp: num(e.target.value) as any })} /></Labeled>
          </div>
          {f.onHandTenVialPhp != null && Number(f.onHandTenVialPhp) > 0 && (
            <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">
              {php(Number(f.onHandTenVialPhp) / ON_HAND_BUNDLE_VIALS)} per vial across the {ON_HAND_BUNDLE_VIALS}.
            </p>
          )}
        </>
      )}
      {/* Shared terms for both board channels — the figures every campaign or
          hatian carrying this product starts from. Shown when either board
          channel is on, because either one seeds itself from them. */}
      {(f.isGroupBuy || f.isKahati) && (
        <>
          <div className="mt-4 border-t border-line-soft pt-4 text-[13px] font-semibold text-ink-body">
            Group Buy &amp; Kahati terms
          </div>
          <p className="mt-1 text-[12px] leading-snug text-ink-muted">
            Counted in vials. A campaign converts them to kits when it seeds itself, and a hatian
            caps at {KAHATI_MAX_VIALS} vials — one kit — whatever is entered here. Leave a field
            blank to use the shop default.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Labeled label="Group Buy price / kit ₱"><input className={field} type="number" min={0} value={(f.gbPricePerKitPhp as any) ?? ''} onChange={(e) => setF({ ...f, gbPricePerKitPhp: e.target.value === '' ? null : e.target.value })} /></Labeled>
            <Labeled label="Group Buy price / piece (per vial) ₱"><input className={field} type="number" min={0} value={(f.gbPricePerPiecePhp as any) ?? ''} onChange={(e) => setF({ ...f, gbPricePerPiecePhp: e.target.value === '' ? null : e.target.value })} /></Labeled>
            <Labeled label="Vials per kit"><input className={field} type="number" min={1} value={(f.gbVialsPerKit as any) ?? ''} onChange={(e) => setF({ ...f, gbVialsPerKit: num(e.target.value) })} /></Labeled>
            <Labeled label="Minimum order (vials)"><input className={field} type="number" min={1} value={(f.gbMinVials as any) ?? ''} onChange={(e) => setF({ ...f, gbMinVials: num(e.target.value) })} /></Labeled>
            <Labeled label="Maximum vials per batch"><input className={field} type="number" min={1} value={(f.gbMaxVialsPerBatch as any) ?? ''} onChange={(e) => setF({ ...f, gbMaxVialsPerBatch: num(e.target.value) })} /></Labeled>
          </div>
        </>
      )}

      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saveProduct.isPending} onClick={submit}>{saveProduct.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

export default function AdminProductsPage() {
  const { data: products = [], isLoading } = useAdminProducts();
  const { archiveProduct } = useMutate();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<Product> | null>(null);

  const handleArchive = async (p: Product) => {
    const ok = await confirm({
      title: `Archive "${p.name}"?`,
      message: 'This hides the product from the storefront. You can restore it later.',
      confirmLabel: 'Archive product',
    });
    if (ok) archiveProduct.mutate(p.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Products</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Edit catalog &amp; on-hand prices. {products.length} items.</p>
        </div>
        <button className={btnPrimary} onClick={() => setEditing(blank())}>+ New product</button>
      </div>

      <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3">Product</th><th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">On-hand (kit / pc)</th><th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Arrival</th><th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={6}>Loading…</td></tr> :
              products.map((p) => (
                <tr key={p.id} className={`border-b border-line-soft/60 ${!p.isActive ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{p.imageEmoji} {p.name}</div>
                    <div className="text-[11.5px] text-ink-muted">{p.spec} · {p.code}</div>
                  </td>
                  <td className="px-4 py-3 font-display font-bold">{php(p.pricePhp)}</td>
                  <td className="px-4 py-3 text-ink-body">{p.isOnHand ? `${php(p.onHandKitPhp || 0)} / ${php(p.onHandPiecePhp || 0)}` : <span className="text-ink-faint">—</span>}</td>
                  <td className="px-4 py-3">{p.stock}</td>
                  <td className="px-4 py-3"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${p.arrivalGroup === 'white_powder' ? 'bg-[#e8f5db] text-brand-greendark' : 'bg-warn-bg text-warn-fg'}`}>{p.arrivalGroup === 'white_powder' ? 'White' : 'Salt/Liquid'}</span></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(p)} className="mr-2 font-semibold text-brand-blue">Edit</button>
                    {p.isActive && <button onClick={() => handleArchive(p)} className="font-semibold text-[#b23b3b]">Archive</button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {editing && <ProductForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
