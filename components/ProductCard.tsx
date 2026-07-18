'use client';
import { useRouter } from 'next/navigation';
import type { Product } from '@/lib/types';
import { php } from '@/lib/format';
import { useCart } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';

export function ProductCard({ p }: { p: Product }) {
  const router = useRouter();
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);

  const quickAdd = () => {
    add({ key: `product:${p.id}`, kind: 'product', refId: p.id, name: `${p.name} ${p.spec}`, spec: p.categoryName || '', unitPricePhp: Number(p.pricePhp), minQty: 1 });
    toast(`Added: ${p.name} ${p.spec}`);
  };

  return (
    <div className="flex flex-col rounded-[14px] bg-white p-3 shadow-card">
      <button onClick={() => router.push(`/product/${p.id}`)}
        className="mb-2.5 flex h-16 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#eef3fb] to-[#e9f5de] text-[22px]">
        {p.imageEmoji || '💧'}
      </button>
      <button onClick={() => router.push(`/product/${p.id}`)} className="text-left text-[13.5px] font-bold leading-tight text-ink">{p.name}</button>
      <div className="mb-2 mt-0.5 text-[11.5px] text-ink-muted">{p.spec}</div>
      <div className="mt-auto flex items-center justify-between">
        <strong className="font-display text-[14.5px] text-ink">{php(p.pricePhp)}</strong>
        <button onClick={quickAdd}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-[#e8f5db] text-[16px] font-extrabold text-brand-greendark active:scale-95">+</button>
      </div>
    </div>
  );
}
