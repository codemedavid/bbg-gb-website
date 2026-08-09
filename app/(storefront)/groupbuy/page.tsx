'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionHeader } from '@/components/headers';
import { BoardControls } from '@/components/BoardControls';
import { CampaignCard } from '@/components/CampaignCard';
import { CommitSheet } from '@/components/CommitSheet';
import { useCampaigns } from '@/lib/queries';
import { useToast } from '@/lib/store/toast';
import { filterAndSortBoard, type BoardSort } from '@/lib/board-filter';
import type { MoqCampaign } from '@/lib/types';

// The Group Buy (MOQ) board — its own route, layout and lifecycle, separate from
// the Kahati board at /kahati.
//
// Kahati splits one 10-vial kit among barkada and locks at the cap. A group buy
// pools whole kits until the supplier's minimum clears; it can overshoot, run to
// a deadline, be approved below MOQ by an admin, or be cancelled with refunds.
// Different money, different rules, different page.

const STEPS = [
  'Pick a group buy and add whole kits to your cart — no splitting, no per-vial math.',
  'Keep shopping: add more group buys or anything else, then pay for the lot in one checkout.',
  'One packing fee per checkout, however many group buys you bought — and none at all if you already have an order going in the same group buy.',
  'Once the MOQ is met, the batch is ordered from the supplier and we ship to you. A cancelled group buy refunds everyone in full.',
];

// What a search looks through on this board. A campaign's own name and blurb,
// plus the names of every product the batch carries — a customer searching
// "retatrutide" means the vial, and on this board the vial is a line inside the
// batch rather than the batch's own title.
const searchFields = (c: MoqCampaign): (string | null | undefined)[] => [
  c.name,
  c.description,
  ...c.includedProducts.map((p) => p.name),
];

export default function GroupBuyPage() {
  const router = useRouter();
  const { data: campaigns = [], isLoading } = useCampaigns();
  const [committing, setCommitting] = useState<MoqCampaign | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<BoardSort>('default');
  const toast = useToast((s) => s.show);

  // No login gate. Committing used to place a real order from this page, so an
  // anonymous visitor had to sign in first; it now only puts a line in a
  // localStorage cart, exactly like the Kahati board and the shop. Checkout is
  // where the session is required, and it redirects there itself.
  const startCommit = (c: MoqCampaign) => setCommitting(c);

  // Searched and sorted before the open/closed split, so both lists answer the
  // same query — a closed batch of the thing you searched for is still the
  // thing you searched for, and hiding it would read as "we never carried it".
  const shown = useMemo(() => filterAndSortBoard(campaigns, {
    query, sort, fields: searchFields,
    name: (c) => c.name,
    // Kits committed, not fill percentage: a batch 5/10 has more people behind
    // it than one 1/2, and "most popular" is about people, not proportion.
    progress: (c) => c.committed,
  }), [campaigns, query, sort]);

  const open = shown.filter((c) => c.status === 'open');
  // A scheduled batch has not happened yet, so it belongs in neither list. The
  // API already withholds it from customers; this keeps an admin browsing the
  // storefront from seeing their unannounced campaign filed under "closed".
  const closed = shown.filter((c) => c.status !== 'open' && c.status !== 'scheduled');

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

        <BoardControls
          query={query} onQueryChange={setQuery}
          sort={sort} onSortChange={setSort}
          placeholder="Search group buys by name or product…"
          progressLabel="Most kits committed"
          resultCount={shown.length}
        />

        {isLoading ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">Loading group buys…</p>
        ) : shown.length === 0 ? (
          <div className="rounded-[14px] border-[1.5px] border-dashed border-line bg-white px-4 py-10 text-center">
            {/* An empty board and an empty search are different problems, and
                telling a searching customer "no group buys open" would read as
                "we do not run these" rather than "not that one". */}
            {query.trim() ? (
              <>
                <p className="m-0 text-[14px] font-bold text-ink">No group buys match “{query.trim()}”</p>
                <button onClick={() => setQuery('')}
                  className="mt-2 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-body transition-colors hover:border-brand-green hover:text-brand-greendark">
                  Clear search
                </button>
              </>
            ) : (
              <>
                <p className="m-0 text-[14px] font-bold text-ink">No group buys open right now</p>
                <p className="mt-1 text-[12.5px] text-ink-muted">New campaigns post here — check the Kahati board in the meantime.</p>
              </>
            )}
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
          // Added to the cart, not ordered — so no success screen and no
          // navigation. The customer stays on the board and keeps shopping.
          onAdded={(c) => toast(`${c.name} added to cart — pwede ka pang mamili.`)}
        />
      )}
    </>
  );
}
