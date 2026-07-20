'use client';
import type { MoqProduct } from '@/lib/types';
import { php } from '@/lib/format';

// The MOQ shelf card.
//
// Intentionally shares nothing with GroupBuyCard or CampaignCard: those two are
// progress-driven (slots filling, MOQ climbing toward a target), whereas an MOQ
// product is simply stock you may buy in bulk. So this card leads with the
// image and the minimum-order badge instead of a progress bar — the minimum is
// the single fact that distinguishes this shelf from the shop.
export function MoqProductCard({ p, onAdd }: { p: MoqProduct; onAdd: (p: MoqProduct) => void }) {
  const buyable = p.inStock;

  return (
    <article className="group flex flex-col overflow-hidden rounded-[16px] bg-white shadow-card transition-shadow hover:shadow-lg">
      {/* Media block — the shelf reads visually first, unlike the board pages. */}
      <div className="relative flex h-[132px] items-center justify-center bg-gradient-to-br from-[#eef3ea] to-[#dce7f2]">
        {p.imageUrl ? (
          <img src={p.imageUrl} alt={p.name} width={320} height={132} loading="lazy"
            className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden className="text-[44px] leading-none">{p.imageEmoji ?? '📦'}</span>
        )}
        <span className="absolute left-2.5 top-2.5 rounded-md bg-brand-navy px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-wide text-white">
          min {p.minOrderQty}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[15px] font-bold leading-tight text-ink">{p.name}</h3>
        <div className="mt-0.5 text-[12px] text-ink-muted">{p.spec}</div>

        {p.description && (
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-ink-body">{p.description}</p>
        )}

        <div className="mt-3 flex items-end justify-between gap-2">
          <div>
            <div className="font-display text-[19px] font-bold leading-none text-brand-greendark">
              {php(p.pricePhp)}
            </div>
            {/* Availability is stated once, here. The button reads "Unavailable"
                rather than repeating it a second and third time on one card. */}
            <div className={`mt-1 text-[11.5px] font-semibold ${buyable ? 'text-ink-muted' : 'text-warn-fg'}`}>
              {buyable ? `${p.stock} in stock` : 'Out of stock'}
            </div>
          </div>

          <button type="button" disabled={!buyable} onClick={() => buyable && onAdd(p)}
            className="flex-none rounded-full bg-brand-green px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-brand-greendark disabled:cursor-not-allowed disabled:bg-[#c8d2c4] disabled:text-white/70">
            {buyable ? `Add ${p.minOrderQty}` : 'Unavailable'}
          </button>
        </div>
      </div>
    </article>
  );
}
