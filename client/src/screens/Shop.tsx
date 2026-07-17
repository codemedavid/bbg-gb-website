import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CartButton } from '../components/BottomNav';
import { ProductCard } from '../components/ProductCard';
import { useProducts, useCategories } from '../hooks/queries';

export function Shop() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const activeCat = params.get('cat') || 'All';
  const { data: categories = [] } = useCategories();
  const catParam = activeCat === 'All' ? undefined : categories.find((c) => c.name === activeCat)?.slug;
  const { data: products = [], isLoading } = useProducts({ category: catParam, q });

  const chips = ['All', ...categories.map((c) => c.name)];
  const setCat = (c: string) => setParams(c === 'All' ? {} : { cat: c });

  return (
    <>
      <header className="sticky top-0 z-10 border-b-2 border-brand-green bg-white px-4 pb-2.5 pt-3.5">
        <div className="mb-2.5 flex items-center gap-2.5">
          <div className="font-display text-[18px] font-bold text-ink">🧪 Shop</div>
          <div className="ml-auto"><CartButton onClick={() => nav('/cart')} size={38} /></div>
        </div>
        <input name="search" aria-label="Search peptides" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search peptides…"
          className="w-full rounded-[10px] border-[1.5px] border-line bg-surface-field px-3.5 py-2.5 text-[14px] outline-none focus:border-brand-green" />
      </header>
      <div className="px-4 py-3">
        <div className="mb-3.5 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`rounded-full border px-3.5 py-[7px] text-[12px] font-semibold ${
                activeCat === c ? 'border-brand-navy bg-brand-navy text-white' : 'border-line bg-white text-ink-body'}`}>
              {c}
            </button>
          ))}
        </div>
        {isLoading ? (
          <div className="py-16 text-center text-[13px] text-ink-muted">Loading…</div>
        ) : products.length ? (
          <div className="grid grid-cols-2 gap-2.5">
            {products.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        ) : (
          <div className="py-16 text-center text-[13px] text-ink-muted">Walang nahanap. Try another search.</div>
        )}
      </div>
    </>
  );
}
