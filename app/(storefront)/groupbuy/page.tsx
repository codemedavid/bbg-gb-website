'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionHeader } from '@/components/headers';
import { CampaignCard } from '@/components/CampaignCard';
import { CommitSheet } from '@/components/CommitSheet';
import { useCampaigns } from '@/lib/queries';
import { useAuth } from '@/lib/useAuth';
import { useToast } from '@/lib/store/toast';
import type { MoqCampaign } from '@/lib/types';

// The Group Buy (MOQ) board — its own route, layout and lifecycle, separate from
// the Kahati board at /kahati.
//
// Kahati splits one 10-vial kit among barkada and locks at the cap. A group buy
// pools whole kits until the supplier's minimum clears; it can overshoot, run to
// a deadline, be approved below MOQ by an admin, or be cancelled with refunds.
// Different money, different rules, different page.

const STEPS = [
  'Pick a group buy and commit whole kits — no splitting, no per-vial math.',
  'Pay in full and upload your proof. Your payment is held against the campaign.',
  'Once the MOQ is met, the batch is ordered from the supplier and we ship to you.',
  'Short of MOQ at the deadline? The admin can still approve it, extend it, or cancel it — and a cancelled group buy refunds everyone in full.',
];

export default function GroupBuyPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: campaigns = [], isLoading } = useCampaigns();
  const [committing, setCommitting] = useState<MoqCampaign | null>(null);
  const toast = useToast((s) => s.show);

  // Committing places a real order, so an anonymous visitor is sent to log in
  // rather than filling a form that cannot succeed.
  const startCommit = (c: MoqCampaign) => {
    if (!user) { router.push('/login'); return; }
    setCommitting(c);
  };

  const open = campaigns.filter((c) => c.status === 'open');
  const closed = campaigns.filter((c) => c.status !== 'open');

  return (
    <>
      <SectionHeader title="🧺 Group Buy" sub="Pool whole kits · unlock the supplier minimum together" />
      <div className="p-4 md:p-6">
        <div className="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <div className="rounded-[14px] bg-white px-4 py-3.5 shadow-card lg:col-span-2">
            <h2 className="mb-2.5 text-[13px] font-bold text-ink">How a group buy works</h2>
            <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[12.5px] leading-snug text-ink-body">
              {STEPS.map((t, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#dbe8f5] text-[11px] font-bold text-brand-navy">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-[14px] bg-brand-navy px-4 py-3.5 text-white">
            <div className="mb-1 text-[13px] font-bold">🤝 Looking for kahati?</div>
            <p className="m-0 text-[12.5px] leading-relaxed opacity-90">
              Want a single vial instead of a whole kit? That is the Kahati board — barkada split one kit between them.
            </p>
            <button onClick={() => router.push('/kahati')}
              className="mt-2.5 rounded-full bg-white/15 px-3.5 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-white/25">
              Go to Kahati →
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">Loading group buys…</p>
        ) : campaigns.length === 0 ? (
          <div className="rounded-[14px] border-[1.5px] border-dashed border-line bg-white px-4 py-10 text-center">
            <p className="m-0 text-[14px] font-bold text-ink">No group buys open right now</p>
            <p className="mt-1 text-[12.5px] text-ink-muted">New campaigns post here — check the Kahati board in the meantime.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {open.map((c) => <CampaignCard key={c.id} c={c} onCommit={startCommit} />)}
            </div>

            {closed.length > 0 && (
              <>
                <h2 className="mx-0.5 mb-2.5 mt-5 font-display text-[15px] font-bold text-ink-muted">Closed</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {closed.map((c) => <CampaignCard key={c.id} c={c} onCommit={startCommit} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {committing && (
        <CommitSheet
          c={committing}
          onClose={() => setCommitting(null)}
          onCommitted={(orderNo) => {
            setCommitting(null);
            toast('Committed! Nakareserve na ang kits mo.');
            router.push(`/success/${orderNo}`);
          }}
        />
      )}
    </>
  );
}
