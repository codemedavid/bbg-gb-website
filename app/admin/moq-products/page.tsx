'use client';
import { useState, type FormEvent } from 'react';
import { useAdminMoqProducts, useMutate } from '@/lib/admin-api';
import { field, label, btnPrimary } from '@/components/admin-ui';
import { php } from '@/lib/format';
import type { MoqProduct } from '@/lib/types';

// Admin management for the MOQ shelf.
//
// Scoped on purpose: this screen only ever reads and writes moq_products, so the
// main catalog cannot be edited from here. Saving posts multipart because the
// product image travels with the fields.

type Draft = {
  id?: string;
  name: string; spec: string; description: string;
  pricePhp: string; stock: string; minOrderQty: string;
  packingFeePhp: string; imageEmoji: string; sortOrder: string;
  isActive: boolean;
};

const emptyDraft: Draft = {
  name: '', spec: '', description: '', pricePhp: '0', stock: '0', minOrderQty: '1',
  packingFeePhp: '', imageEmoji: '📦', sortOrder: '0', isActive: true,
};

const toDraft = (p: MoqProduct): Draft => ({
  id: p.id, name: p.name, spec: p.spec, description: p.description ?? '',
  pricePhp: p.pricePhp, stock: String(p.stock), minOrderQty: String(p.minOrderQty),
  packingFeePhp: p.packingFeePhp ?? '', imageEmoji: p.imageEmoji ?? '📦',
  sortOrder: String(p.sortOrder), isActive: p.isActive,
});

export default function AdminMoqProductsPage() {
  const { data: items = [], isLoading } = useAdminMoqProducts();
  const { saveMoqProduct, deleteMoqProduct } = useMutate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => (d ? { ...d, [k]: e.target.value } : d));

  const startNew = () => { setDraft(emptyDraft); setImage(null); setError(null); };
  const startEdit = (p: MoqProduct) => { setDraft(toDraft(p)); setImage(null); setError(null); };
  const close = () => { setDraft(null); setImage(null); setError(null); };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError(null);

    const body = new FormData();
    body.set('name', draft.name);
    body.set('spec', draft.spec);
    body.set('description', draft.description);
    body.set('pricePhp', draft.pricePhp || '0');
    body.set('stock', draft.stock || '0');
    body.set('minOrderQty', draft.minOrderQty || '1');
    // Blank means "use the global MOQ packing fee", so the field is omitted.
    if (draft.packingFeePhp !== '') body.set('packingFeePhp', draft.packingFeePhp);
    body.set('imageEmoji', draft.imageEmoji);
    body.set('sortOrder', draft.sortOrder || '0');
    body.set('isActive', String(draft.isActive));
    if (image) body.set('image', image);

    try {
      await saveMoqProduct.mutateAsync({ id: draft.id, body });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the MOQ product.');
    }
  };

  const handleDelete = async (p: MoqProduct) => {
    if (!confirm(`Delete "${p.name}" from the MOQ shelf?`)) return;
    await deleteMoqProduct.mutateAsync(p.id);
  };

  return (
    <div className="pb-10">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold text-brand-navy">MOQ Products</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            The bulk shelf shown on the storefront MOQ page. Turn the page itself on or off in Settings.
          </p>
        </div>
        <button onClick={startNew} className={btnPrimary}>+ Add product</button>
      </div>

      {isLoading ? (
        <p className="text-[13px] text-ink-muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-card">
          <p className="text-[13.5px] text-ink-muted">No MOQ products yet. Add the first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <div key={p.id} className={`rounded-2xl bg-white p-4 shadow-card ${p.isActive ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-[10px] bg-[#eef3ea] text-[22px]">
                  {p.imageUrl ? <img src={p.imageUrl} alt={p.name} width={48} height={48} className="h-full w-full object-cover" /> : (p.imageEmoji ?? '📦')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold text-ink">{p.name}</div>
                  <div className="text-[12px] text-ink-muted">{p.spec}</div>
                </div>
                {!p.isActive && <span className="flex-none rounded-md bg-warn-bg px-2 py-[3px] text-[10.5px] font-bold text-warn-fg">Archived</span>}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-[8px] bg-[#f5f8f3] py-1.5">
                  <div className="text-[13px] font-bold text-brand-greendark">{php(p.pricePhp)}</div>
                  <div className="text-[10.5px] text-ink-muted">price</div>
                </div>
                <div className="rounded-[8px] bg-[#f5f8f3] py-1.5">
                  <div className="text-[13px] font-bold text-ink">{p.stock}</div>
                  <div className="text-[10.5px] text-ink-muted">stock</div>
                </div>
                <div className="rounded-[8px] bg-[#f5f8f3] py-1.5">
                  <div className="text-[13px] font-bold text-ink">{p.minOrderQty}</div>
                  <div className="text-[10.5px] text-ink-muted">min qty</div>
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button onClick={() => startEdit(p)} className="flex-1 rounded-[10px] bg-brand-navy px-3 py-2 text-[12.5px] font-bold text-white">Edit</button>
                <button onClick={() => handleDelete(p)} className="rounded-[10px] border border-[#e3b9b9] px-3 py-2 text-[12.5px] font-bold text-[#a33]">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6" onClick={close}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}
            className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl bg-white p-5 md:rounded-2xl">
            <h2 className="mb-4 font-display text-[18px] font-bold text-brand-navy">
              {draft.id ? 'Edit MOQ product' : 'Add MOQ product'}
            </h2>

            <div className="flex flex-col gap-3">
              <label className="block">
                <span className={label}>Name</span>
                <input required minLength={2} className={field} value={draft.name} onChange={set('name')} />
              </label>
              <label className="block">
                <span className={label}>Spec</span>
                <input className={field} value={draft.spec} onChange={set('spec')} placeholder="e.g. 1500mg" />
              </label>
              <label className="block">
                <span className={label}>Description</span>
                <textarea rows={3} className={field} value={draft.description} onChange={set('description')} />
              </label>

              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className={label}>Price ₱</span>
                  <input type="number" min={0} step="0.01" required className={field} value={draft.pricePhp} onChange={set('pricePhp')} />
                </label>
                <label className="block">
                  <span className={label}>Stock</span>
                  <input type="number" min={0} step="1" className={field} value={draft.stock} onChange={set('stock')} />
                </label>
                <label className="block">
                  <span className={label}>Min order qty</span>
                  <input type="number" min={1} step="1" className={field} value={draft.minOrderQty} onChange={set('minOrderQty')} />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className={label}>Packing fee ₱</span>
                  <input type="number" min={0} step="1" className={field} value={draft.packingFeePhp} onChange={set('packingFeePhp')} placeholder="default" />
                </label>
                <label className="block">
                  <span className={label}>Emoji</span>
                  <input maxLength={8} className={field} value={draft.imageEmoji} onChange={set('imageEmoji')} />
                </label>
                <label className="block">
                  <span className={label}>Sort order</span>
                  <input type="number" min={0} step="1" className={field} value={draft.sortOrder} onChange={set('sortOrder')} />
                </label>
              </div>

              <label className="block">
                <span className={label}>Image</span>
                <input type="file" accept="image/*" className={field}
                  onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
                <span className="mt-0.5 block text-[12px] text-ink-muted">
                  Optional. Leave empty to keep the current image; the emoji is used when there is none.
                </span>
              </label>

              <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-body">
                <input type="checkbox" checked={draft.isActive}
                  onChange={(e) => setDraft((d) => (d ? { ...d, isActive: e.target.checked } : d))} />
                Visible on the MOQ page
              </label>

              {error && <p role="alert" className="rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}

              <div className="mt-1 flex gap-2">
                <button type="button" onClick={close} className="flex-1 rounded-[10px] border border-line px-3 py-2.5 text-[13px] font-bold text-ink-body">Cancel</button>
                <button type="submit" disabled={saveMoqProduct.isPending} className={`flex-1 ${btnPrimary}`}>
                  {saveMoqProduct.isPending ? 'Saving…' : 'Save product'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
