'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/headers';
import { GroupBuyCard } from '@/components/GroupBuyCard';
import { JoinSheet } from '@/components/JoinSheet';
import { useGroupBuys } from '@/lib/queries';
import { useAuth } from '@/lib/useAuth';
import type { GroupBuy } from '@/lib/types';

const CATS = ['GLP-1', 'Blends', 'Recovery', 'Skin', 'Wellness'];

export default function HomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: gbs = [] } = useGroupBuys();
  const [joining, setJoining] = useState<GroupBuy | null>(null);

  return (
    <>
      <AppHeader greeting={user ? `Hi, ${user.name.split(' ')[0]} 👋` : undefined} />
      <div className="px-4 pb-1.5 pt-[18px] md:px-6">
        <div className="mb-4 rounded-[16px] bg-gradient-to-br from-brand-green to-brand-greendark p-[18px] text-white md:p-6">
          <div className="mb-1.5 text-[12px] font-bold tracking-wider opacity-85">🤝 KAHATI NG BARKADA</div>
          <div className="mb-2 font-display text-[22px] font-bold leading-tight md:text-[28px]">Sali na — kahati tayo!</div>
          <div className="text-[13px] leading-relaxed opacity-90 md:max-w-[560px] md:text-[14px]">
            Commit at least 1 vial and pay the downpayment para ma-secure ang order mo. Pagkatapos ma-complete ang hatian, saka mo na lang settle ang total amount ng order.
          </div>
        </div>

        <div className="mb-3.5 flex flex-wrap gap-2">
          {CATS.map((c) => (
            <button key={c} onClick={() => router.push(`/shop?cat=${encodeURIComponent(c)}`)}
              className="rounded-full border border-line bg-white px-3.5 py-[7px] text-[12px] font-semibold text-ink-body">{c}</button>
          ))}
        </div>

        <div className="mx-0.5 mb-2.5 flex items-baseline justify-between">
          <span className="font-display text-[16px] font-bold text-ink">Open kahati</span>
          <button onClick={() => router.push('/kahati')} className="text-[12.5px] font-bold text-brand-blue">See all →</button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {gbs.slice(0, 3).map((g) => <GroupBuyCard key={g.id} g={g} onJoin={setJoining} />)}
        </div>

        <button onClick={() => router.push('/calc')}
          className="mt-4 flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-dashed border-[#a9c88f] bg-white p-3.5 text-left">
          <div className="text-2xl">🧮</div>
          <div className="flex-1">
            <div className="text-[14px] font-bold text-ink">Peptide calculator</div>
            <div className="text-[12px] text-ink-muted">Ilang units sa syringe? Compute here.</div>
          </div>
          <div className="text-[18px] font-bold text-brand-green">→</div>
        </button>
      </div>
      {joining && <JoinSheet g={joining} onClose={() => setJoining(null)} />}
    </>
  );
}
