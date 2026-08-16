'use client';
import type { MoqProduct } from '@/lib/types';
import { php } from '@/lib/format';

// The MOQ shelf card.
//
// Still shares nothing with GroupBuyCard or CampaignCard, even though all three
// now show progress. Those two count KITS towards a batch that seals at ten and
// rolls into a successor; this counts UNITS towards a target that is welcome to
// be overshot and only moves on when an admin closes the round. The numbers
// mean different things, so they get different components.
//
// Nothing here can be "out of stock": the shelf holds no stock. A listed item is
// always buyable, because a target that is short is the reason to order.
export function MoqProductCard({ p, onAdd }: { p: MoqProduct; onAdd: (p: MoqProduct) => void }) {
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
          MOQ {p.moq}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[15px] font-bold leading-tight text-ink">{p.name}</h3>
        <div className="mt-0.5 text-[12px] text-ink-muted">{p.spec}</div>

        {p.description && (
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-ink-body">{p.description}</p>
        )}

        {/* The buy's progress, stated once and given room: it is the fact that
            decides whether a customer orders now or waits. */}
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] font-bold text-ink">{p.committed} / {p.moq}</span>
            <span className={`text-[11.5px] font-semibold ${p.reached ? 'text-brand-greendark' : 'text-ink-muted'}`}>
              {p.reached ? '🎉 Target reached' : `${p.remaining} more to go`}
            </span>
          </div>
          <div role="progressbar" aria-label={`${p.name} group buy progress`}
            aria-valuenow={p.committed} aria-valuemin={0} aria-valuemax={p.moq}
            className="h-2 overflow-hidden rounded-full bg-[#e8eee5]">
            <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${p.reached ? 'bg-brand-green' : 'bg-brand-navy'}`}
              style={{ width: `${Math.round(p.progress * 100)}%` }} />
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="font-display text-[19px] font-bold leading-none text-brand-greendark">
            {php(p.pricePhp)}
          </div>

          <button type="button" onClick={() => onAdd(p)}
            className="flex-none rounded-full bg-brand-green px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-brand-greendark">
            Add to cart
          </button>
        </div>
      </div>
    </article>
  );
}
