'use client';
import { useRouter } from 'next/navigation';
import type { Product } from '@/lib/types';
import { php } from '@/lib/format';
import { useCart } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';
import { onHandUnitPrice } from '@/lib/pricing';

// Below this many vials the on-hand count is shown as a scarcity nudge.
const LOW_STOCK = 10;

export function ProductCard({ p }: { p: Product }) {
  const router = useRouter();
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);

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
      <button onClick={open} className="text-left text-[13.5px] font-bold leading-tight text-ink">{p.name}</button>
      <div className="mt-0.5 text-[11.5px] text-ink-muted">{p.spec}</div>
      <div className={`mb-2 text-[11px] font-semibold ${stockTone}`}>{stockNote}</div>
      <div className="mt-auto flex items-center justify-between">
        <strong className="font-display text-[14.5px] text-ink">
          {piecePrice != null ? php(piecePrice) : php(p.pricePhp)}
        </strong>
        <button onClick={quickAdd} disabled={!canQuickAdd}
          aria-label={`Add ${p.name} ${p.spec} to cart`}
          className={`flex h-[30px] w-[30px] items-center justify-center rounded-[9px] text-[16px] font-extrabold ${
            canQuickAdd
              ? 'bg-[#e8f5db] text-brand-greendark active:scale-95'
              : 'cursor-not-allowed bg-surface-mist text-ink-faint'}`}>+</button>
      </div>
    </div>
  );
}
