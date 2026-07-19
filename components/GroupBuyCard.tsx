'use client';
import type { GroupBuy } from '@/lib/types';
import { php, closesIn } from '@/lib/format';
import { KAHATI_MIN_VIABLE_VIALS, isKahatiViable, kahatiBadge, kahatiProgressPercent } from '@/lib/kahati';

export function GroupBuyCard({ g, onJoin }: { g: GroupBuy; onJoin: (g: GroupBuy) => void }) {
  const badge = kahatiBadge(g.status, g.claimedSlots, g.totalSlots);
  const progress = kahatiProgressPercent(g.claimedSlots, g.totalSlots);
  const closed = g.status !== 'open';
  // Reaching the minimum is what decides whether the batch is ordered at all, so
  // it earns the green treatment — the cap only decides when the counter rolls over.
  const viable = isKahatiViable(g.claimedSlots);
  const minMarkerPct = kahatiProgressPercent(KAHATI_MIN_VIABLE_VIALS, g.totalSlots);
  const stillNeeded = Math.max(0, KAHATI_MIN_VIABLE_VIALS - g.claimedSlots);
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-card">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-bold text-ink">{g.name}</span>
        <span className={`flex-none rounded-md px-2 py-[3px] text-[10.5px] font-bold ${
          !closed && viable ? 'bg-[#e8f5db] text-brand-greendark' : 'bg-warn-bg text-warn-fg'}`}>
          {badge}
        </span>
      </div>
      <div className="mb-2.5 text-[12px] text-ink-muted">
        {php(g.pricePerKitPhp)}/kit · min {g.minVials} vials/kahati · closes {closesIn(g.closesAt)}
      </div>
      <div className="mb-1.5 flex items-center gap-2.5">
        <div className="relative h-[9px] flex-1 overflow-hidden rounded-full bg-[#edf2ea]">
          <div className="h-full rounded-full bg-gradient-to-r from-brand-blue to-brand-green transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }} />
          {/* Where the hatian becomes viable — the number that actually matters. */}
          <span aria-hidden className="absolute top-0 h-full w-[2px] bg-brand-navy/45"
            style={{ left: `${minMarkerPct}%` }} />
        </div>
        <span className="flex-none text-[12px] font-bold text-brand-greendark">{g.claimedSlots}/{g.totalSlots}</span>
      </div>
      <div className={`mb-3 text-[11.5px] font-semibold ${viable ? 'text-brand-greendark' : 'text-warn-fg'}`}>
        {closed
          ? `Needed ${KAHATI_MIN_VIABLE_VIALS} vials to push through`
          : viable
            ? `✓ Good to go — past the ${KAHATI_MIN_VIABLE_VIALS}-vial minimum`
            : `${stillNeeded} more ${stillNeeded === 1 ? 'vial' : 'vials'} to reach the ${KAHATI_MIN_VIABLE_VIALS}-vial minimum`}
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] text-ink-muted">Per vial</div>
          <strong className="font-display text-[19px] text-ink">{php(g.perVialPhp)}</strong>
        </div>
        <button disabled={closed} onClick={() => onJoin(g)}
          className="rounded-[10px] bg-brand-green px-5 py-2.5 text-[13px] font-bold text-white active:scale-95 disabled:bg-ink-faint">
          {closed ? 'Closed' : 'Sali!'}
        </button>
      </div>
    </div>
  );
}
