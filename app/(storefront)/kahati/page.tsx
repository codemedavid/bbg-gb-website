'use client';
import { useMemo, useState } from 'react';
import { SectionHeader } from '@/components/headers';
import { BoardControls } from '@/components/BoardControls';
import { GroupBuyCard } from '@/components/GroupBuyCard';
import { JoinSheet } from '@/components/JoinSheet';
import { useGroupBuys } from '@/lib/queries';
import { KAHATI_MIN_VIABLE_VIALS } from '@/lib/kahati';
import { filterAndSortBoard, type BoardSort } from '@/lib/board-filter';
import type { GroupBuy } from '@/lib/types';

const STEPS = [
  'Commit at least 1 vial — each hatian fills one kit (10 vials).',
  'Pay the downpayment & upload your proof to secure your order.',
  `A hatian pushes through once it reaches ${KAHATI_MIN_VIABLE_VIALS} vials — "Good to Go". Under ${KAHATI_MIN_VIABLE_VIALS} by the deadline and it is cancelled, with your downpayment refunded.`,
  'Hit 10 vials and the hatian locks early — a fresh one opens automatically.',
  'Once the hatian is complete, settle the balance — then we split, repack & ship direct to you. ₱150 packing fee, local shipping included.',
];

// A counter's name is seeded as "<product> <spec>" (lib/kahati-seed.ts), so the
// variant a customer types is already in it; the description carries whatever
// the admin added on top.
const searchFields = (g: GroupBuy): (string | null | undefined)[] => [g.name, g.description];

export default function KahatiPage() {
  const { data: gbs = [] } = useGroupBuys();
  const [joining, setJoining] = useState<GroupBuy | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<BoardSort>('default');

  // 'default' leaves the server's demand ranking alone — the counters closest to
  // filling already lead (lib/kahati.ts sortHatiansByDemand). 'progress' asks
  // for the same thing explicitly, so a customer who picks it gets what the
  // label promises rather than a silently identical list.
  const shown = useMemo(() => filterAndSortBoard(gbs, {
    query, sort, fields: searchFields,
    name: (g) => g.name,
    progress: (g) => g.claimedSlots,
  }), [gbs, query, sort]);

  return (
    <>
      <SectionHeader title="🤝 Kahati Board" sub={`Shared orders · ${KAHATI_MIN_VIABLE_VIALS} vials minimum · we split & repack`} />
      <div className="p-4 md:p-6">
        <div className="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <div className="rounded-[14px] bg-white px-4 py-3.5 shadow-card">
            <div className="mb-2.5 text-[13px] font-bold text-ink">How it works</div>
            <div className="flex flex-col gap-2 text-[12.5px] leading-snug text-ink-body">
              {STEPS.map((t, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#e8f5db] text-[11px] font-bold text-brand-greendark">{i + 1}</span>
                  {t}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[14px] bg-brand-navy px-4 py-3.5 text-white">
            <div className="mb-1 text-[13px] font-bold">📦 On-hand</div>
            <div className="text-[12.5px] leading-relaxed opacity-90">
              Ayaw maghintay? Ready stock is in the Shop — buy per piece or per kit, any quantity, shipped within 24h.
            </div>
          </div>

          <div className="rounded-[14px] border border-warn-softln bg-warn-softbg px-4 py-3.5">
            <div className="mb-1 text-[13px] font-bold text-[#8a6400]">🛬 Arrival notes</div>
            <div className="text-[12.5px] leading-relaxed text-[#6b5a24]">
              White powder peptides arrive first. Salt forms, Bioglutide, TR+CGL / TR+RT blends, colored peptides &amp; liquid blends (incl. NAD+) follow 3–5 days later. Place them in separate orders to avoid delays.
            </div>
          </div>
        </div>

        <BoardControls
          query={query} onQueryChange={setQuery}
          sort={sort} onSortChange={setSort}
          placeholder="Search hatians by product or variant…"
          progressLabel="Most vials committed"
          resultCount={shown.length}
        />

        {shown.length === 0 ? (
          <div className="rounded-[14px] border-[1.5px] border-dashed border-line bg-white px-4 py-10 text-center">
            {query.trim() ? (
              <>
                <p className="m-0 text-[14px] font-bold text-ink">No hatians match “{query.trim()}”</p>
                <button onClick={() => setQuery('')}
                  className="mt-2 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-body transition-colors hover:border-brand-green hover:text-brand-greendark">
                  Clear search
                </button>
              </>
            ) : (
              <>
                <p className="m-0 text-[14px] font-bold text-ink">No hatians open right now</p>
                <p className="mt-1 text-[12.5px] text-ink-muted">New counters post here — try the Group Buy board in the meantime.</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {shown.map((g) => <GroupBuyCard key={g.id} g={g} onJoin={setJoining} />)}
          </div>
        )}
      </div>
      {joining && <JoinSheet g={joining} onClose={() => setJoining(null)} />}
    </>
  );
}
