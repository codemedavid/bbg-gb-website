'use client';
import { SectionHeader } from '@/components/headers';
import { MoqProductCard } from '@/components/MoqProductCard';
import { useMoqProducts } from '@/lib/queries';
import { moqCartLine, useCart } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';
import type { MoqProduct } from '@/lib/types';

// The MOQ shelf.
//
// Its own route, its own card and its own business rule: every item carries a
// MOQ — the units all buyers together must reach before the order is placed with
// the supplier. Nothing here is shared with the Kahati board or the Group Buy
// campaign board: those count kits into a batch that seals at ten, this counts
// units towards a target that is welcome to be passed.
const STEPS = [
  'Each item has a MOQ — the total units all of us together need to reach before it can be ordered.',
  'Order any quantity you want. Every order adds to the total, and the bar shows how close it is.',
  'Once the MOQ is reached, the buy goes ahead. Until then your order waits with the rest.',
  'Check out and upload your proof of payment — MOQ items are paid in full, as their own order.',
];

export function MoqBoard() {
  const { data: items = [], isLoading } = useMoqProducts();
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);

  const handleAdd = (p: MoqProduct) => {
    add(moqCartLine(p));
    toast(`${p.name} added to cart`);
  };

  return (
    <>
      <SectionHeader title="🏷️ MOQ" sub="Bulk buys · we order once the target is reached" />
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
