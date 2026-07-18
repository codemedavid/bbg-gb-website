'use client';
import { useState } from 'react';
import { useAdminProducts, useAdminCategories, useMutate } from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import { php } from '@/lib/format';
import type { Product } from '@/lib/types';

const blank = (): Partial<Product> => ({ name: '', spec: '', pricePhp: '0', arrivalGroup: 'white_powder', isOnHand: false, stock: 0, imageEmoji: '💧', isActive: true });

function ProductForm({ initial, onClose }: { initial: Partial<Product>; onClose: () => void }) {
  const { data: cats = [] } = useAdminCategories();
  const { saveProduct } = useMutate();
  const [f, setF] = useState<Partial<Product>>(initial);
  const num = (v: string) => (v === '' ? null : Number(v));

  const submit = async () => {
    await saveProduct.mutateAsync({
      id: f.id,
      name: f.name, spec: f.spec, categoryId: f.categoryId ?? null,
      pricePhp: Number(f.pricePhp) as any, priceUsd: (f.priceUsd != null ? Number(f.priceUsd) : null) as any,
      isOnHand: f.isOnHand, onHandKitPhp: (f.onHandKitPhp != null ? Number(f.onHandKitPhp) : null) as any,
      onHandPiecePhp: (f.onHandPiecePhp != null ? Number(f.onHandPiecePhp) : null) as any,
      stock: f.stock, arrivalGroup: f.arrivalGroup, imageEmoji: f.imageEmoji, description: f.description ?? null,
    } as any);
    onClose();
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
      </div>

      <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-ink-body">
        <input type="checkbox" checked={!!f.isOnHand} onChange={(e) => setF({ ...f, isOnHand: e.target.checked })} /> On-hand (ready stock) — enable on-hand pricing
      </label>
      {f.isOnHand && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Labeled label="On-hand price / kit ₱"><input className={field} type="number" value={(f.onHandKitPhp as any) ?? ''} onChange={(e) => setF({ ...f, onHandKitPhp: num(e.target.value) as any })} /></Labeled>
          <Labeled label="On-hand price / piece ₱"><input className={field} type="number" value={(f.onHandPiecePhp as any) ?? ''} onChange={(e) => setF({ ...f, onHandPiecePhp: num(e.target.value) as any })} /></Labeled>
        </div>
      )}
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
  const [editing, setEditing] = useState<Partial<Product> | null>(null);

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
                    {p.isActive && <button onClick={() => archiveProduct.mutate(p.id)} className="font-semibold text-[#b23b3b]">Archive</button>}
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
