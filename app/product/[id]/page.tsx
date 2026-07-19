'use client';
import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { OverlayShell } from '@/components/OverlayShell';
import { BackHeader } from '@/components/headers';
import { useProduct } from '@/lib/queries';
import { php } from '@/lib/format';
import { useCart } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';
import { onHandUnitPrice, vialsFor, VIALS_PER_KIT, type OnHandUnit } from '@/lib/pricing';

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: p, isLoading } = useProduct(id);
  const [qty, setQty] = useState(1);
  const [unit, setUnit] = useState<OnHandUnit>('piece');
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);

  const piecePrice = p ? onHandUnitPrice(p, 'piece') : null;
  const kitPrice = p ? onHandUnitPrice(p, 'kit') : null;
  const unitPrice = unit === 'kit' ? kitPrice : piecePrice;
  const stock = p?.stock ?? 0;
  // Stock is counted in vials, so a kit costs VIALS_PER_KIT of it.
  const maxQty = Math.floor(stock / vialsFor(unit, 1));
  const soldOut = stock <= 0 || maxQty < 1;
  const canAdd = !!p && unitPrice != null && !soldOut && qty <= maxQty;

  // Switching units rescales what is affordable — never leave a stale over-limit qty.
  const chooseUnit = (next: OnHandUnit) => {
    setUnit(next);
    setQty((q) => Math.max(1, Math.min(q, Math.floor(stock / vialsFor(next, 1)))));
  };

  const addToCart = () => {
    if (!p || unitPrice == null || !canAdd) return;
    add({
      key: `product:${p.id}:${unit}`, kind: 'product', refId: p.id, unit,
      name: `${p.name} ${p.spec}`, spec: p.categoryName || '',
      unitPricePhp: unitPrice, minQty: 1, qty, stock,
    });
    toast(`Added: ${p.name} ${p.spec}${unit === 'kit' ? ` · kit of ${VIALS_PER_KIT}` : ''}`);
    router.back();
  };

  const downloadCoa = () => {
    const coa = p?.coaFiles?.[0];
    if (!coa) { toast('COA for this batch is available on request.'); return; }
    window.open(`/api/coa/${coa.id}/download`, '_blank');
  };

  if (isLoading || !p) {
    return <OverlayShell><BackHeader title="Product" /><div className="p-10 text-center text-ink-muted">Loading…</div></OverlayShell>;
  }

  return (
    <OverlayShell>
      <BackHeader title="Product" />
      <div className="p-4 md:grid md:grid-cols-2 md:items-start md:gap-6 md:p-6">
        <div className="mb-3.5 flex h-[180px] items-center justify-center rounded-[16px] bg-gradient-to-br from-[#eef3fb] to-[#e9f5de] text-[56px] md:sticky md:top-[76px] md:mb-0 md:h-[340px] md:text-[80px]">{p.imageEmoji || '💧'}</div>
        <div>
        <div className="flex items-baseline justify-between gap-2.5">
          <h1 className="m-0 font-display text-[22px] text-ink">{p.name}</h1>
          <span className="flex-none rounded-md bg-[#e8f5db] px-2.5 py-1 text-[11px] font-bold text-brand-greendark">{p.categoryName}</span>
        </div>
        <div className="my-1 text-[13px] text-ink-muted">{p.spec} · lab-tested</div>
        <div className="mb-1 font-display text-[26px] font-bold text-ink">
          {unitPrice != null ? php(unitPrice) : php(p.pricePhp)}
          <span className="ml-1 font-sans text-[13px] font-semibold text-ink-muted">
            {unit === 'kit' ? `/ kit of ${VIALS_PER_KIT}` : '/ piece'}
          </span>
        </div>
        <div className={`mb-3 text-[12.5px] font-semibold ${soldOut ? 'text-[#c2410c]' : 'text-brand-greendark'}`}>
          {soldOut ? 'Out of stock — join a kahati instead' : `📦 ${stock} on hand · ships within 24h`}
        </div>

        {piecePrice != null && kitPrice != null && (
          <div className="mb-3.5 flex gap-2" role="group" aria-label="Buy by piece or kit">
            {([
              { key: 'piece' as const, label: 'Per piece', price: piecePrice, note: '1 vial' },
              { key: 'kit' as const, label: `Kit of ${VIALS_PER_KIT}`, price: kitPrice, note: `save ${php(piecePrice * VIALS_PER_KIT - kitPrice)}` },
            ]).map((o) => {
              const active = unit === o.key;
              const available = Math.floor(stock / vialsFor(o.key, 1)) >= 1;
              return (
                <button key={o.key} type="button" onClick={() => chooseUnit(o.key)} disabled={!available}
                  aria-pressed={active}
                  className={`flex-1 rounded-[12px] border-[1.5px] px-3 py-2.5 text-left transition-colors ${
                    active ? 'border-brand-green bg-[#f2f8ec]' : 'border-line bg-white hover:border-[#a9c88f]'
                  } ${available ? '' : 'cursor-not-allowed opacity-50'}`}>
                  <div className="text-[12px] font-bold text-ink">{o.label}</div>
                  <div className="font-display text-[15px] font-bold text-ink">{php(o.price)}</div>
                  <div className="text-[11px] text-ink-muted">{available ? o.note : 'unavailable'}</div>
                </button>
              );
            })}
          </div>
        )}

        <p className="m-0 mb-3.5 text-[13.5px] leading-relaxed text-ink-body">{p.description}</p>

        <button onClick={downloadCoa} className="mb-4 flex w-full items-center gap-2.5 rounded-[12px] border-[1.5px] border-[#a9c88f] bg-white px-3.5 py-3 text-left">
          <span className="text-[18px]">📄</span>
          <div className="flex-1">
            <div className="text-[13px] font-bold text-ink">COA — Certificate of Analysis</div>
            <div className="text-[11.5px] text-ink-muted">{p.coaFiles?.length ? `Batch ${p.coaFiles[0].batch || '—'} · PDF` : 'Third-party tested · request per batch'}</div>
          </div>
          <span className="text-[12px] font-bold text-brand-greendark">Download</span>
        </button>

        <div className="flex items-center gap-3">
          <div className="flex items-center overflow-hidden rounded-[12px] border-[1.5px] border-line">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={soldOut} aria-label="Decrease quantity"
              className="flex h-[46px] w-[42px] items-center justify-center text-[18px] font-bold text-ink-body disabled:text-ink-faint">−</button>
            <span className="w-9 text-center text-[16px] font-bold text-ink">{qty}</span>
            <button onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={soldOut || qty >= maxQty} aria-label="Increase quantity"
              className="flex h-[46px] w-[42px] items-center justify-center text-[18px] font-bold text-ink-body disabled:text-ink-faint">+</button>
          </div>
          <button onClick={addToCart} disabled={!canAdd}
            className={`flex-1 rounded-[12px] py-3.5 text-center text-[15px] font-bold text-white ${
              canAdd ? 'bg-brand-green active:scale-[.99]' : 'bg-[#b9c6b4]'}`}>
            {soldOut ? 'Out of stock' : 'Add to cart'}
          </button>
        </div>
        {!soldOut && qty >= maxQty && (
          <div className="mt-2 text-[12px] text-ink-muted">
            That&apos;s everything we have on hand{unit === 'kit' ? ` (${maxQty} kit${maxQty === 1 ? '' : 's'})` : ''}.
          </div>
        )}
        </div>
      </div>
    </OverlayShell>
  );
}
