'use client';
import { useState } from 'react';
import { SectionHeader } from '@/components/headers';
import { GroupBuyCard } from '@/components/GroupBuyCard';
import { JoinSheet } from '@/components/JoinSheet';
import { useGroupBuys } from '@/lib/queries';
import type { GroupBuy } from '@/lib/types';

const STEPS = [
  'Commit your vials — minimum 7 per kahati.',
  'Pay via bank transfer & upload your proof.',
  'Admins close the kahati → we split, repack & ship direct to you. ₱150 packing fee, local shipping included.',
];

export default function KahatiPage() {
  const { data: gbs = [] } = useGroupBuys();
  const [joining, setJoining] = useState<GroupBuy | null>(null);

  return (
    <>
      <SectionHeader title="🤝 Kahati Board" sub="Shared orders · admins close & we repack" />
      <div className="p-4">
        <div className="mb-3.5 rounded-[14px] bg-white px-4 py-3.5 shadow-card">
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

        <div className="mb-3.5 rounded-[14px] bg-brand-navy px-4 py-3.5 text-white">
          <div className="mb-1 text-[13px] font-bold">📦 Solo Buy</div>
          <div className="text-[12.5px] leading-relaxed opacity-90">
            Minimum 10 kits of any peptide + 10 BAC water. Processed immediately — order straight from the Shop.
          </div>
        </div>

        <div className="mb-3.5 rounded-[14px] border border-warn-softln bg-warn-softbg px-4 py-3.5">
          <div className="mb-1 text-[13px] font-bold text-[#8a6400]">🛬 Arrival notes</div>
          <div className="text-[12.5px] leading-relaxed text-[#6b5a24]">
            White powder peptides arrive first. Salt forms, Bioglutide, TR+CGL / TR+RT blends, colored peptides &amp; liquid blends (incl. NAD+) follow 3–5 days later. Place them in separate orders to avoid delays.
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {gbs.map((g) => <GroupBuyCard key={g.id} g={g} onJoin={setJoining} />)}
        </div>
      </div>
      {joining && <JoinSheet g={joining} onClose={() => setJoining(null)} />}
    </>
  );
}
