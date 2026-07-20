'use client';
import { SectionHeader } from '@/components/headers';
import { MoqProductCard } from '@/components/MoqProductCard';
import { useMoqProducts } from '@/lib/queries';
import { useCart } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';
import type { MoqProduct } from '@/lib/types';

// The MOQ shelf.
//
// Its own route, its own card and its own business rule: every item carries an
// admin-set minimum order quantity, so adding to the cart seeds the line at that
// minimum rather than at 1. Nothing here is shared with the Kahati board or the
// Group Buy campaign board — no slots, no MOQ progress bar, no commitments.
const STEPS = [
  'Each item on this shelf has a minimum order quantity — add it and you start at that minimum.',
  'Adjust the quantity in your cart, up to whatever stock is left.',
  'Check out and upload your proof of payment. MOQ items are paid in full.',
  'MOQ items check out as their own order, separate from on-hand, hatian and group buy.',
];

export function MoqBoard() {
  const { data: items = [], isLoading } = useMoqProducts();
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);

  const handleAdd = (p: MoqProduct) => {
    add({
      key: `moq:${p.id}`,
      kind: 'moq',
      refId: p.id,
      name: p.name,
      spec: p.spec,
      unitPricePhp: Number(p.pricePhp),
      minQty: p.minOrderQty,
      qty: p.minOrderQty,
      stock: p.stock,
      packingFeePhp: p.packingFeePhp != null ? Number(p.packingFeePhp) : undefined,
    });
    toast(`${p.name} × ${p.minOrderQty} added to cart`);
  };

  return (
    <>
      <SectionHeader title="🏷️ MOQ" sub="Bulk shelf · minimum order per item" />
      <div className="p-4 md:p-6">
        <div className="mb-3.5 rounded-[14px] bg-white px-4 py-3.5 shadow-card">
          <h2 className="mb-2.5 text-[13px] font-bold text-ink">How the MOQ shelf works</h2>
          <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[12.5px] leading-snug text-ink-body">
            {STEPS.map((t, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#dbe8f5] text-[11px] font-bold text-brand-navy">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">Loading the MOQ shelf…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">No MOQ products are listed right now.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => <MoqProductCard key={p.id} p={p} onAdd={handleAdd} />)}
          </div>
        )}
      </div>
    </>
  );
}
