'use client';
import { useState } from 'react';
import { SectionHeader } from '@/components/headers';
import { PasaloCard } from '@/components/PasaloCard';
import { JoinSheet } from '@/components/JoinSheet';
import { usePasaloBoard } from '@/lib/queries';
import type { PasaloCounter } from '@/lib/types';

// The Pasalo (Bunuan) board.
//
// Its own page rather than a section of /kahati, because it answers a different
// question. The Kahati board is a shop: here is what is filling, join what you
// fancy. This is a rescue list — every counter on it is a batch that fell short
// and whose buyers get refunded unless a few more vials arrive before the admin
// closes the stage. Mixing them would bury the urgency in the ordinary.
//
// Empty is the good state and says so. A board with nothing on it means every
// batch reached its minimum, which is the outcome the whole stage exists for —
// rendering that as a bleak "no results" would read as breakage.
export default function PasaloPage() {
  const { data: counters = [], isLoading } = usePasaloBoard();
  const [joining, setJoining] = useState<PasaloCounter | null>(null);

  const rescuable = counters.filter((c) => c.neededToQualify > 0);
  const secured = counters.filter((c) => c.neededToQualify === 0);

  return (
    <>
      <SectionHeader
        title="🔥 Pasalo / Bunuan"
        sub="Last call — tulungan nating ma-abot ang minimum bago mag-refund"
      />
      <div className="p-4 md:p-6">
        <section className="mb-4 rounded-[14px] border border-warn-softln bg-warn-softbg px-4 py-3.5">
          <h2 className="m-0 mb-1 text-[13px] font-bold text-[#8a6400]">Ano ang Pasalo?</h2>
          <p className="m-0 text-[12.5px] leading-relaxed text-[#6b5a24]">
            Kapag hindi umabot ang isang hatian sa minimum nito, hindi agad namin
            kina-cancel. Binubuksan namin dito para sa huling pagkakataon — kung
            maabot ang minimum bago magsara, tuloy ang batch para sa lahat.
            Kung hindi pa rin, saka lang mare-refund ang mga hindi natuloy.
          </p>
        </section>

        {isLoading && <p className="text-ink-muted">Loading…</p>}

        {!isLoading && counters.length === 0 && (
          <div className="rounded-[14px] border-[1.5px] border-dashed border-line bg-white px-4 py-10 text-center">
            <p className="m-0 text-[14px] font-bold text-ink">Walang Pasalo ngayon 🎉</p>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Ibig sabihin naabot ng lahat ng batch ang minimum nila. Tingnan ang
              Kahati board para sa mga bukas na counter.
            </p>
          </div>
        )}

        {rescuable.length > 0 && (
          <section aria-labelledby="pasalo-needs-help" className="mb-6">
            <h2 id="pasalo-needs-help" className="mb-2.5 text-[13px] font-bold text-ink">
              Kulang pa — kailangan ng tulong ({rescuable.length})
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {rescuable.map((c) => <PasaloCard key={c.id} c={c} onJoin={setJoining} />)}
            </div>
          </section>
        )}

        {secured.length > 0 && (
          <section aria-labelledby="pasalo-secured">
            <h2 id="pasalo-secured" className="mb-2.5 text-[13px] font-bold text-ink">
              Tuloy na — pwede pa ring sumabay ({secured.length})
            </h2>
            <p className="mb-2.5 text-[12px] text-ink-muted">
              Sigurado nang matutuloy ang mga ito. Bukas pa rin hanggang mapuno ang kahon.
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {secured.map((c) => <PasaloCard key={c.id} c={c} onJoin={setJoining} />)}
            </div>
          </section>
        )}
      </div>
      {joining && <JoinSheet g={joining} onClose={() => setJoining(null)} />}
    </>
  );
}
