'use client';
import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CartButton } from '@/components/BottomNav';
import { ProductCard } from '@/components/ProductCard';
import { useProducts, useCategories } from '@/lib/queries';

function ShopInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const activeCat = params.get('cat') || 'All';
  const { data: categories = [] } = useCategories();
  const catSlug = activeCat === 'All' ? undefined : categories.find((c) => c.name === activeCat)?.slug;
  // The shop sells ready stock only — everything else is reached through kahati.
  const { data: products = [], isLoading } = useProducts({ category: catSlug, q, onHand: true });

  const chips = ['All', ...categories.map((c) => c.name)];
  const setCat = (c: string) => router.push(c === 'All' ? '/shop' : `/shop?cat=${encodeURIComponent(c)}`);

  return (
    <>
      <header className="sticky top-0 z-10 border-b-2 border-brand-green bg-white px-4 pb-2.5 pt-3.5 md:px-6">
        <div className="mb-2.5 flex items-center gap-2.5">
          <div>
            <div className="font-display text-[18px] font-bold leading-tight text-ink">📦 On-hand</div>
            <div className="text-[11.5px] text-ink-muted">Ready stock · ships within 24h</div>
          </div>
          <div className="ml-auto"><CartButton size={38} /></div>
        </div>
        <input name="search" aria-label="Search peptides" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search peptides…"
          className="w-full rounded-[10px] border-[1.5px] border-line bg-surface-field px-3.5 py-2.5 text-[14px] outline-none focus:border-brand-green" />
      </header>
      <div className="px-4 py-3 md:px-6 md:py-4">
        <div className="mb-3.5 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`rounded-full border px-3.5 py-[7px] text-[12px] font-semibold ${
                activeCat === c ? 'border-brand-navy bg-brand-navy text-white' : 'border-line bg-white text-ink-body'}`}>{c}</button>
          ))}
        </div>
        {isLoading ? <div className="py-16 text-center text-[13px] text-ink-muted">Loading…</div>
          : products.length ? <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3 lg:grid-cols-4">{products.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          : <div className="py-16 text-center text-[13px] text-ink-muted">
              Walang on-hand dito ngayon. Try another search — or join a kahati para sa pre-order.
            </div>}
      </div>
    </>
  );
}

export default function ShopPage() {
  return <Suspense fallback={<div className="py-16 text-center text-ink-muted">Loading…</div>}><ShopInner /></Suspense>;
}
