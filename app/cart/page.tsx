'use client';
import { useRouter } from 'next/navigation';
import { OverlayShell } from '@/components/OverlayShell';
import { BackHeader } from '@/components/headers';
import { OrderSummary } from '@/components/OrderSummary';
import { useCart } from '@/lib/store/cart';
import { php } from '@/lib/format';

export default function CartPage() {
  const router = useRouter();
  const items = useCart((s) => s.items);
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const count = useCart((s) => s.count());

  return (
    <OverlayShell>
      <BackHeader title={`Cart · ${count}`} />
      <div className="p-4">
        {!items.length && (
          <div className="px-5 py-16 text-center text-ink-muted">
            <div className="mb-2.5 text-4xl">🛒</div>
            <div className="mb-1 font-bold text-ink-body">Wala pang laman</div>
            <div className="text-[13px]">Join a kahati or add from the shop.</div>
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          {items.map((i) => (
            <div key={i.key} className="flex items-center gap-3 rounded-[14px] bg-white p-3.5 shadow-card">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold text-ink">{i.name}</div>
                <div className="text-[11.5px] text-ink-muted">{i.spec}</div>
              </div>
              <div className="flex items-center overflow-hidden rounded-[9px] border border-line">
                <button onClick={() => dec(i.key)} className="flex h-[30px] w-7 items-center justify-center font-bold text-ink-body">−</button>
                <span className="w-6 text-center text-[13px] font-bold">{i.qty}</span>
                <button onClick={() => inc(i.key)} className="flex h-[30px] w-7 items-center justify-center font-bold text-ink-body">+</button>
              </div>
              <strong className="w-[70px] text-right text-[13.5px] text-ink">{php(i.qty * i.unitPricePhp)}</strong>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <>
            <div className="mt-3.5 rounded-[14px] bg-white p-4 shadow-card"><OrderSummary /></div>
            <button onClick={() => router.push('/checkout')} className="mt-3.5 block w-full rounded-[12px] bg-brand-blue py-[15px] text-center text-[15px] font-bold text-white active:scale-[.99]">Proceed to checkout</button>
          </>
        )}
      </div>
    </OverlayShell>
  );
}
