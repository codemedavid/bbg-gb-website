'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Product } from '@/lib/types';
import type { VariantGroup } from '@/lib/product-variants';
import { php } from '@/lib/format';
import { useCart } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';
import { onHandUnitPrice } from '@/lib/pricing';
import { VariantPicker } from './VariantPicker';

// One card per peptide, not one per strength.
//
// Tirzepatide is five rows in the catalogue, and the shelf used to list all
// five: the same name read five times, with the prices to compare spread across
// five cards. The card now takes the whole group and lets the customer pick the
// strength on the card itself.
//
// The selected strength is the ONLY thing the price, the stock line and the add
// button read from — quoting one strength's price and adding another is the
// specific failure this has to not have.

// Below this many vials the on-hand count is shown as a scarcity nudge.
const LOW_STOCK = 10;

export function ProductCard({ group }: { group: VariantGroup<Product> }) {
  const router = useRouter();
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);

  // Defaults to the first variant, which groupVariants has already ordered by
  // magnitude — so a peptide opens on its lowest dose rather than whichever row
  // the database happened to return first.
  const [selectedId, setSelectedId] = useState(group.variants[0].id);
  const p = group.variants.find((v) => v.id === selectedId) ?? group.variants[0];

  const piecePrice = onHandUnitPrice(p, 'piece');
  const soldOut = p.stock <= 0;
  const canQuickAdd = !soldOut && piecePrice != null;
  const open = () => router.push(`/product/${p.id}`);

  const quickAdd = () => {
    if (!canQuickAdd) return;
    add({
      key: `product:${p.id}:piece`, kind: 'product', refId: p.id, unit: 'piece',
      name: `${p.name} ${p.spec}`, spec: p.categoryName || '',
      unitPricePhp: piecePrice, minQty: 1, stock: p.stock,
    });
    toast(`Added: ${p.name} ${p.spec}`);
  };

  const stockNote = soldOut ? 'Out of stock' : `${p.stock} on hand`;
  const stockTone = soldOut ? 'text-ink-faint' : p.stock <= LOW_STOCK ? 'text-[#c2410c]' : 'text-brand-greendark';

  return (
    <div className={`flex flex-col rounded-[14px] bg-white p-3 shadow-card ${soldOut ? 'opacity-60' : ''}`}>
      <button onClick={open}
        className="relative mb-2.5 flex h-16 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#eef3fb] to-[#e9f5de] text-[22px]">
        {p.imageEmoji || '💧'}
        {soldOut && (
          <span className="absolute inset-x-0 bottom-0 rounded-b-[9px] bg-ink/70 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Sold out
          </span>
        )}
      </button>
      <button onClick={open} className="break-words text-left text-[13.5px] font-bold leading-tight text-ink">{group.name}</button>

      {/* A choice of one is not a choice — a lone strength reads as a label. */}
      {group.isSingle ? (
        <div className="mt-0.5 text-[11.5px] text-ink-muted">{p.spec}</div>
      ) : (
        <VariantPicker
          productName={group.name}
          value={p.id}
          onChange={setSelectedId}
          options={group.variants.map((v) => ({
            value: v.id,
            label: v.spec,
            disabled: v.stock <= 0,
            note: 'sold out',
          }))}
        />
      )}

      <div className={`mb-2 mt-1 text-[11px] font-semibold ${stockTone}`}>{stockNote}</div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <strong className="font-display text-[14.5px] text-ink">
          {piecePrice != null ? php(piecePrice) : php(p.pricePhp)}
        </strong>
        <button onClick={quickAdd} disabled={!canQuickAdd}
          aria-label={`Add ${p.name} ${p.spec} to cart`}
          className={`flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] text-[16px] font-extrabold ${
            canQuickAdd
              ? 'bg-[#e8f5db] text-brand-greendark active:scale-95'
              : 'cursor-not-allowed bg-surface-mist text-ink-faint'}`}>+</button>
      </div>
    </div>
  );
}
