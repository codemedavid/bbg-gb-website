import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { OverlayShell } from '../components/OverlayShell';
import { BackHeader } from '../components/headers';
import { useProduct } from '../hooks/queries';
import { php } from '../lib/format';
import { api } from '../lib/api';
import { useCart } from '../store/cart';
import { useToast } from '../store/toast';

export function Product() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: p, isLoading } = useProduct(id);
  const [qty, setQty] = useState(1);
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);

  const addToCart = () => {
    if (!p) return;
    add({ key: `product:${p.id}`, kind: 'product', refId: p.id, name: `${p.name} ${p.spec}`, spec: p.categoryName || '', unitPricePhp: Number(p.pricePhp), minQty: 1, qty });
    toast(`Added: ${p.name} ${p.spec}`);
    nav(-1);
  };

  const downloadCoa = async () => {
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
      <div className="p-4">
        <div className="mb-3.5 flex h-[180px] items-center justify-center rounded-[16px] bg-gradient-to-br from-[#eef3fb] to-[#e9f5de] text-[56px]">
          {p.imageEmoji || '💧'}
        </div>
        <div className="flex items-baseline justify-between gap-2.5">
          <h1 className="m-0 font-display text-[22px] text-ink">{p.name}</h1>
          <span className="flex-none rounded-md bg-[#e8f5db] px-2.5 py-1 text-[11px] font-bold text-brand-greendark">{p.categoryName}</span>
        </div>
        <div className="my-1 text-[13px] text-ink-muted">{p.spec} · lab-tested</div>
        <div className="mb-3 font-display text-[26px] font-bold text-ink">{php(p.pricePhp)}</div>
        <p className="m-0 mb-3.5 text-[13.5px] leading-relaxed text-ink-body">{p.description}</p>

        <button onClick={downloadCoa}
          className="mb-4 flex w-full items-center gap-2.5 rounded-[12px] border-[1.5px] border-[#a9c88f] bg-white px-3.5 py-3 text-left">
          <span className="text-[18px]">📄</span>
          <div className="flex-1">
            <div className="text-[13px] font-bold text-ink">COA — Certificate of Analysis</div>
            <div className="text-[11.5px] text-ink-muted">{p.coaFiles?.length ? `Batch ${p.coaFiles[0].batch || '—'} · PDF` : 'Third-party tested · request per batch'}</div>
          </div>
          <span className="text-[12px] font-bold text-brand-greendark">Download</span>
        </button>

        <div className="flex items-center gap-3">
          <div className="flex items-center overflow-hidden rounded-[12px] border-[1.5px] border-line">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-[46px] w-[42px] items-center justify-center text-[18px] font-bold text-ink-body">−</button>
            <span className="w-9 text-center text-[16px] font-bold text-ink">{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} className="flex h-[46px] w-[42px] items-center justify-center text-[18px] font-bold text-ink-body">+</button>
          </div>
          <button onClick={addToCart} className="flex-1 rounded-[12px] bg-brand-green py-3.5 text-center text-[15px] font-bold text-white active:scale-[.99]">
            Add to cart
          </button>
        </div>
      </div>
    </OverlayShell>
  );
}
