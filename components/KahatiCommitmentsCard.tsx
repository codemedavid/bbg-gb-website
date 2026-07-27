'use client';
import { php } from '@/lib/format';
import type { KahatiCommitments } from '@/lib/types';

// What the customer already has on order across their hatians. It stands in for
// the payment section on a commitment that owes nothing: the question they are
// actually answering there is not "how do I pay" but "what am I adding this to".
export function KahatiCommitmentsCard({ summary }: { summary: KahatiCommitments['summary'] }) {
  return (
    <section aria-labelledby="kahati-held-heading" className="rounded-[14px] bg-white p-4 shadow-card">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 id="kahati-held-heading" className="text-[13px] font-bold text-ink">Your kahati orders so far</h2>
        <span className="text-[11.5px] text-ink-muted">
          {summary.orderCount} order{summary.orderCount === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-body">
        May ongoing kahati ka na, kaya walang bayad ngayon — hindi na kailangan ng panibagong downpayment.
        Isang bayad na lang sa huling checkout kapag tapos na lahat.
      </p>

      <ul className="flex flex-col gap-2">
        {summary.groups.map((g) => (
          <li key={g.kahatiName} className="rounded-[10px] bg-surface-mist px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[13.5px] font-bold text-ink">{g.kahatiName}</span>
              <strong className="font-display text-[14px] text-ink">{php(g.totalPhp)}</strong>
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-muted">
              {g.vials} vial{g.vials === 1 ? '' : 's'} · {g.orderNos.join(', ')}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex justify-between border-t border-line-soft pt-2.5 text-[13px] font-bold text-ink">
        <span>Total on your hatians</span>
        <span className="font-display">{summary.vials} vials · {php(summary.totalPhp)}</span>
      </div>
    </section>
  );
}
