'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionHeader } from '@/components/headers';
import { useOrders } from '@/lib/queries';
import { useAuth } from '@/lib/useAuth';
import { php, shortDate } from '@/lib/format';
import { STATUS_FLOW, STATUS_LABEL, STATUS_BADGE, statusIndex } from '@/lib/order-status';
import { useToast } from '@/lib/store/toast';
import type { Order } from '@/lib/types';

function Timeline({ order }: { order: Order }) {
  const current = statusIndex(order.status);
  return (
    <div>
      {STATUS_FLOW.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <div key={s} className="flex items-start gap-2.5">
            <div className="flex flex-col items-center">
              <div className="mt-0.5 h-3 w-3 rounded-full" style={{ background: done ? '#57a814' : active ? '#0b46b8' : '#d3ddd2' }} />
              {i < STATUS_FLOW.length - 1 && <div className="h-4 w-0.5" style={{ background: done ? '#a9c88f' : '#e6ece4' }} />}
            </div>
            <div className="text-[12.5px]" style={{ color: active ? '#0b46b8' : done ? '#33413d' : '#98a29b', fontWeight: active ? 700 : done ? 600 : 400 }}>
              {STATUS_LABEL[s]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const toast = useToast((s) => s.show);
  const first = order.items?.[0];
  const itemsText = first ? `${first.nameSnapshot}${(order.items?.length || 0) > 1 ? ` +${order.items!.length - 1} more` : ''}` : '';
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <div>
          <div className="text-[14.5px] font-bold text-ink">{order.orderNo}</div>
          <div className="text-[12px] text-ink-muted">{shortDate(order.createdAt)} · {itemsText}</div>
        </div>
        <span className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${STATUS_BADGE[order.status] || ''}`}>{STATUS_LABEL[order.status]}</span>
      </button>
      {open && (
        <div className="mt-3.5 border-t border-line-soft pt-3.5">
          <Timeline order={order} />
          {order.trackingNo && <div className="mt-2 rounded-[10px] bg-surface-mist px-3 py-2.5 text-[12.5px] text-ink-body">🚚 {order.trackingNo} — in transit</div>}
          <div className="mt-3 flex items-center justify-between">
            <button onClick={() => toast('COA available on the product page or on request.')}
              className="rounded-[9px] border-[1.5px] border-[#a9c88f] px-3.5 py-2 text-[12px] font-bold text-brand-greendark">📄 Download COA</button>
            <strong className="font-display text-[16px] text-ink">{php(order.totalPhp)}</strong>
          </div>
        </div>
      )}
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
      <div className="flex flex-col gap-3 p-4">
        {isLoading || loading ? <div className="py-16 text-center text-[13px] text-ink-muted">Loading…</div>
          : orders.length ? orders.map((o) => <OrderCard key={o.id} order={o} />)
          : <div className="py-16 text-center text-[13px] text-ink-muted">No orders yet. Sali sa kahati o mag-shop! 🛒</div>}
      </div>
    </>
  );
}
