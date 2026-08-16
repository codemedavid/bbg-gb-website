'use client';
import { useMemo, useState } from 'react';
import { SectionHeader } from '@/components/headers';
import { ProductCard } from '@/components/ProductCard';
import { GroupBuyCard } from '@/components/GroupBuyCard';
import { CampaignCard } from '@/components/CampaignCard';
import { CommitSheet } from '@/components/CommitSheet';
import { JoinSheet } from '@/components/JoinSheet';
import { MoqProductCard } from '@/components/MoqProductCard';
import { useCampaigns, useGroupBuys, useMoqPageEnabled, useMoqProducts, useProducts } from '@/lib/queries';
import { matchesBoardSearch } from '@/lib/board-filter';
import { groupVariants } from '@/lib/product-variants';
import { moqCartLine, useCart } from '@/lib/store/cart';
import { useToast } from '@/lib/store/toast';
import type { GroupBuy, MoqCampaign, MoqProduct } from '@/lib/types';

function ResultSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <h2 className="font-display text-[15px] font-bold text-ink">{title}</h2>
        <span className="text-[11.5px] font-semibold text-ink-muted">{count}</span>
      </div>
      {children}
    </section>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [joining, setJoining] = useState<GroupBuy | null>(null);
  const [committing, setCommitting] = useState<MoqCampaign | null>(null);
  const q = query.trim();
  const hasQuery = q.length > 0;

  const { data: products = [], isLoading: productsLoading } = useProducts({ q, onHand: true });
  const { data: hatians = [], isLoading: hatiansLoading } = useGroupBuys();
  const { data: campaigns = [], isLoading: campaignsLoading } = useCampaigns();
  const { data: moqEnabled } = useMoqPageEnabled();
  const { data: moqProducts = [], isLoading: moqLoading } = useMoqProducts(moqEnabled === true);
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);

  const productGroups = useMemo(() => {
    if (!hasQuery) return [];
    return groupVariants(products, {
      key: (p) => p.name,
      name: (p) => p.name,
      variantLabel: (p) => p.spec,
    });
  }, [hasQuery, products]);

  const shownHatians = useMemo(() => {
    if (!hasQuery) return [];
    return hatians.filter((g) => matchesBoardSearch([g.name, g.description], q));
  }, [hasQuery, hatians, q]);

  const shownCampaigns = useMemo(() => {
    if (!hasQuery) return [];
    return campaigns.filter((c) => matchesBoardSearch([
      c.name,
      c.description,
      ...c.includedProducts.map((p) => p.name),
    ], q));
  }, [hasQuery, campaigns, q]);

  const shownMoq = useMemo(() => {
    if (!hasQuery || moqEnabled !== true) return [];
    return moqProducts.filter((p) => matchesBoardSearch([p.name, p.spec, p.description], q));
  }, [hasQuery, moqEnabled, moqProducts, q]);

  const loading = hasQuery && (productsLoading || hatiansLoading || campaignsLoading || (moqEnabled === true && moqLoading));
  const total = productGroups.length + shownHatians.length + shownCampaigns.length + shownMoq.length;

  const addMoq = (p: MoqProduct) => {
    add(moqCartLine(p));
    toast(`${p.name} added to cart`);
  };

  return (
    <>
      <SectionHeader title="🔎 Search" sub="Find on-hand, Kahati, Group Buy and MOQ items" />
      <div className="p-4 md:p-6">
        <div className="sticky top-[73px] z-[4] -mx-4 border-b border-line-soft bg-surface-mist px-4 pb-3 md:-mx-6 md:px-6">
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">🔍</span>
            <input
              type="search"
              name="search"
              aria-label="Search all products"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search peptides, variants, hatians, group buys…"
              className="w-full rounded-[10px] border-[1.5px] border-line bg-white py-2.5 pl-9 pr-3.5 text-[14px] outline-none transition-colors focus:border-brand-green"
            />
          </div>
        </div>

        {!hasQuery ? (
          <div className="px-5 py-16 text-center text-[13px] text-ink-muted">
            Type a peptide name, dose, blend, or batch to search the storefront.
          </div>
        ) : loading ? (
          <div className="py-16 text-center text-[13px] text-ink-muted">Searching…</div>
        ) : total === 0 ? (
          <div className="py-16 text-center text-[13px] text-ink-muted">No results for “{q}”.</div>
        ) : (
          <>
            <ResultSection title="On-hand" count={productGroups.length}>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3 lg:grid-cols-4">
                {productGroups.map((g) => <ProductCard key={g.key} group={g} />)}
              </div>
            </ResultSection>

            <ResultSection title="Kahati" count={shownHatians.length}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {shownHatians.map((g) => <GroupBuyCard key={g.id} g={g} onJoin={setJoining} />)}
              </div>
            </ResultSection>

            <ResultSection title="Group Buy" count={shownCampaigns.length}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {shownCampaigns.map((c) => <CampaignCard key={c.id} c={c} onCommit={setCommitting} />)}
              </div>
            </ResultSection>

            <ResultSection title="MOQ" count={shownMoq.length}>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {shownMoq.map((p) => <MoqProductCard key={p.id} p={p} onAdd={addMoq} />)}
              </div>
            </ResultSection>
          </>
        )}
      </div>

      {joining && <JoinSheet g={joining} onClose={() => setJoining(null)} />}
      {committing && (
        <CommitSheet
          c={committing}
          onClose={() => setCommitting(null)}
          onAdded={(c) => toast(`${c.name} added to cart — pwede ka pang mamili.`)}
        />
      )}
    </>
  );
}
