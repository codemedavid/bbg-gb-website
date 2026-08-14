'use client';
import { use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { successOrderNos } from '@/lib/order-success';

export default function SuccessPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  // A mixed cart checks out as one order per mode — on-hand ships now, a hatian
  // waits on its batch — so the sibling invoice numbers ride along in `more`.
  // Naming only the first would hide an order the customer just paid for.
  const searchParams = useSearchParams();
  const orderNos = successOrderNos(orderNo, searchParams.get('more'));
  const isSplit = orderNos.length > 1;

  return (
    // overflow-y-auto is load-bearing, not decoration. This is a fixed,
    // full-viewport overlay, so content taller than the screen has nowhere to
    // go: the page itself cannot scroll behind it. On a 320x568 screen an extra
    // ~300px of confirmation detail put BOTH buttons below the fold with no way
    // to reach them — the customer is stranded on the screen that is supposed to
    // tell them their order went through.
    //
    // min-h-full on the inner column is the other half: with justify-center
    // alone, content taller than the container centres and overflows off BOTH
    // edges, and the top half is unreachable even once the parent scrolls.
    // Letting the column grow to its content means centring only applies while
    // there is room to centre in.
    <div className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-surface-mist">
      <div className="flex min-h-full w-full max-w-app flex-col items-center justify-center px-8 py-10 text-center">
        <div className="mb-4 flex h-[74px] w-[74px] items-center justify-center rounded-full bg-brand-green text-[34px] text-white">✓</div>
        <div className="mb-2 font-display text-[22px] font-bold text-ink">Salamat{user ? `, ${user.name.split(' ')[0]}` : ''}!</div>

        {isSplit ? (
          <>
            <div className="mb-1.5 text-[14px] leading-relaxed text-ink-body">{orderNos.length} orders received:</div>
            <ul className="mb-2.5 flex list-none flex-col gap-1 p-0">
              {orderNos.map((no) => <li key={no} className="text-[15px] font-bold text-ink">{no}</li>)}
            </ul>
            <div className="mb-5 rounded-[10px] bg-warn-softbg px-3 py-2 text-[12.5px] leading-snug text-[#6b5a24]">
              Your cart mixed items that ship on different timelines, so each got its own
              separate order — ready stock is not held back waiting for a hatian to fill.
              You only paid once; your proof covers both.
            </div>
          </>
        ) : (
          <div className="mb-1.5 text-[14px] leading-relaxed text-ink-body">Order <strong>{orderNo}</strong> received.</div>
        )}

        <div className="mb-6 text-[13px] leading-relaxed text-ink-muted">We&apos;ll verify your payment proof within 24 hours. You&apos;ll get an email when it&apos;s confirmed.</div>
        <button onClick={() => router.push('/orders')} className="block w-full rounded-[12px] bg-brand-blue py-[15px] text-[15px] font-bold text-white">Track my order{isSplit ? 's' : ''}</button>
        <button onClick={() => router.push('/')} className="mt-2.5 block w-full rounded-[12px] border-[1.5px] border-line py-3 text-[14px] font-semibold text-ink-body">Back to home</button>
      </div>
    </div>
  );
}
