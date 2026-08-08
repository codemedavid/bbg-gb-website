'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionHeader } from '@/components/headers';
import { OrderItemList } from '@/components/OrderItemList';
import { OrderStatusTrail } from '@/components/OrderStatusTrail';
import { useOrders, useSettlementPreview } from '@/lib/queries';
import { useAuth } from '@/lib/useAuth';
import { php, shortDate } from '@/lib/format';
import { STATUS_LABEL, STATUS_BADGE } from '@/lib/order-status';
import { useToast } from '@/lib/store/toast';
import type { Order } from '@/lib/types';

// What the customer is told about a hatian order's packing fee. A settlement
// that exists but is unverified is "under review", never "settled" — and a
// cancelled one drops back to owing.
const PACKING_FEE_LABEL = {
  outstanding: 'Charged once at final checkout',
  under_review: 'Final payment under review',
  settled: 'Settled',
} as const;

function settlementLabelKey(order: Order): keyof typeof PACKING_FEE_LABEL {
  if (!order.settlementId || order.settlementStatus === 'cancelled') return 'outstanding';
  return order.settlementStatus === 'paid' ? 'settled' : 'under_review';
}

function OrderCard({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast((s) => s.show);
  const items = order.items ?? [];
  const downpayment = Number(order.downpaymentPhp ?? 0);
  const balance = Number(order.totalPhp) - downpayment;
  // A count, not a sample. Naming the first item and appending "+3 more" read
  // as though the order were mostly that item, and the other three were
  // nowhere on this screen or any screen reachable from it.
  const itemsText = items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : '';
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-card">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="text-[14.5px] font-bold text-ink">{order.orderNo}</div>
          <div className="text-[12px] text-ink-muted">{shortDate(order.createdAt)} · {itemsText}</div>
        </div>
        <span className={`flex-none rounded-md px-2.5 py-1 text-[11px] font-bold ${STATUS_BADGE[order.status] || ''}`}>{STATUS_LABEL[order.status] ?? order.status}</span>
      </button>
      {open && (
        <div className="mt-3.5 border-t border-line-soft pt-3.5">
          <OrderStatusTrail status={order.status} />
          <div className="mt-3">
            <OrderItemList items={items} />
          </div>
          {order.trackingNo && <div className="mt-2 rounded-[10px] bg-surface-mist px-3 py-2.5 text-[12.5px] text-ink-body">🚚 {order.trackingNo} — in transit</div>}
          {/* Read back to the customer after checkout: the note they typed is
              part of what they agreed to, and it is the only place they can
              confirm we actually received it. */}
          {order.notes && (
            <div className="mt-2 rounded-[10px] border border-line-soft bg-surface-mist px-3 py-2.5 text-[12.5px]">
              <div className="mb-0.5 font-bold text-ink">📝 Your note</div>
              <p className="m-0 whitespace-pre-wrap leading-snug text-ink-body">{order.notes}</p>
            </div>
          )}
          {/* Shown for every order, not only ones carrying a downpayment. This
              block used to be gated on `downpayment > 0`, so an on-hand order —
              which never has one — displayed no subtotal, no fee and no total:
              the customer could see what they bought but not what they paid. */}
          <div data-testid={`order-summary-${order.orderNo}`}
            className="mt-2 rounded-[10px] bg-[#f2f8ec] px-3 py-2.5 text-[12.5px] text-ink-body">
            <div className="flex justify-between"><span>Subtotal</span><span>{php(order.subtotalPhp)}</span></div>
            {Number(order.packingFeePhp) > 0 && (
              <div className="mt-0.5 flex justify-between"><span>Packing fee</span><span>{php(order.packingFeePhp)}</span></div>
            )}
            {downpayment > 0 && (
              <>
                <div className="mt-0.5 flex justify-between font-bold text-brand-greendark"><span>Downpayment paid</span><span>{php(downpayment)}</span></div>
                {balance > 0 && <div className="mt-0.5 flex justify-between"><span>Balance (due after the kahati ends)</span><span>{php(balance)}</span></div>}
              </>
            )}
            {/* The fee is charged at the final checkout, not here — say which
                state this order is in so an unpaid fee is never a surprise.
                Keyed on the settlement's status, not merely on its existence:
                an uploaded proof is not a verified payment, and saying
                "Settled" while the admin panel says "under review" would have
                the two screens contradicting each other. */}
            {order.buyType === 'kahati' && (
              <div className="mt-0.5 flex justify-between">
                <span>Packing fee</span>
                <span data-testid={`packing-fee-${order.orderNo}`}>{PACKING_FEE_LABEL[settlementLabelKey(order)]}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-[#cfe2bb] pt-1 font-bold text-ink">
              <span>Total</span><span>{php(order.totalPhp)}</span>
            </div>
          </div>
          <div className="mt-3">
            <button onClick={() => toast('COA available on the product page or on request.')}
              className="rounded-[10px] border-[1.5px] border-[#a9c88f] px-3.5 py-2.5 text-[12px] font-bold text-brand-greendark">📄 Download COA</button>
          </div>
        </div>
      )}
      {/* Outside the accordion on purpose. The whole point of the details page
          is to be one tap from the order list; putting its entrance behind an
          expand step makes it something the customer has to find first. */}
      <button onClick={() => router.push(`/orders/${order.id}`)}
        className="mt-3 w-full rounded-[10px] border-[1.5px] border-line py-2.5 text-[12.5px] font-bold text-brand-blue transition-colors hover:border-brand-blue active:scale-[.99]">
        View details →
      </button>
    </div>
  );
}

// Completed hatians waiting on their final payment. The customer has no other
// way to discover them, and the packing fee is only ever collected here — so the
// prompt states plainly that the whole lot costs one fee.
function SettlePrompt() {
  const router = useRouter();
  const { data: preview } = useSettlementPreview();
  const ready = preview?.orders.length ?? 0;
  if (!ready) return null;

  return (
    <div className="rounded-[16px] border-[1.5px] border-[#a9c88f] bg-[#f2f8ec] p-4">
      <div className="text-[14px] font-bold text-brand-greendark">
        🎉 {ready} hatian order{ready === 1 ? '' : 's'} ready to settle
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-body">
        Bayaran mo na lahat sa isang checkout — isang packing fee lang para sa buong
        parcel, kahit ilang hatian ang sinalihan mo.
      </p>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-display text-[16px] font-bold text-ink">{php(preview!.totals.totalPhp)}</span>
        <button onClick={() => router.push('/settle')}
          className="rounded-[10px] bg-brand-green px-4 py-2.5 text-[13px] font-bold text-white active:scale-[.99]">
          Settle now →
        </button>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { data: orders = [], isLoading } = useOrders(!!user);

  if (!loading && !user) {
    return (
      <>
        <SectionHeader title="📦 My Orders" sub="Track status · download COA" />
        <div className="px-5 py-16 text-center">
          <div className="mb-3 text-4xl">🔒</div>
          <div className="mb-4 text-[13px] text-ink-muted">Log in to see your orders.</div>
          <button onClick={() => router.push('/login')} className="rounded-[12px] bg-brand-green px-6 py-3 text-[14px] font-bold text-white">Log in</button>
        </div>
      </>
    );
  }

  return (
    <>
      <SectionHeader title="📦 My Orders" sub="Track status · download COA" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4 md:p-6">
        <SettlePrompt />
        {isLoading || loading ? <div className="py-16 text-center text-[13px] text-ink-muted">Loading…</div>
          : orders.length ? orders.map((o) => <OrderCard key={o.id} order={o} />)
          : <div className="py-16 text-center text-[13px] text-ink-muted">No orders yet. Sali sa kahati o mag-shop! 🛒</div>}
      </div>
    </>
  );
}
