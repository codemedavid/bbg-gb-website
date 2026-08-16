'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { BackHeader } from '@/components/headers';
import { OrderItemList } from '@/components/OrderItemList';
import { OrderItemsEditor, type OrderItemDraft } from '@/components/OrderItemsEditor';
import { OrderStatusTrail } from '@/components/OrderStatusTrail';
import { OrderProofSection } from '@/components/OrderProofSection';
import { useOrderDetail } from '@/lib/queries';
import { useAuth } from '@/lib/useAuth';
import { apiSend } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import { php, shortDate } from '@/lib/format';
import { customerEditability, EDIT_BLOCKED_MESSAGE } from '@/lib/order-edit';
import { STATUS_LABEL, STATUS_BADGE } from '@/lib/order-status';

// One order, whole, on one screen.
//
// The complaint this page answers is that reconstructing an order meant walking
// several unrelated screens — and for a large order could not be done at all,
// because the list truncated its items and nothing else showed them. Everything
// the customer might need to check is therefore on this one page: what they
// bought, where it is going, what they paid and how.
//
// Every figure is read off the order's stored columns. Nothing is recomputed
// here: lib/pricing.ts owns that arithmetic, and a second implementation is how
// a receipt gets to disagree with what was actually charged.

function Section({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${testId}-h`} data-testid={testId} className="rounded-[14px] bg-white p-4 shadow-card">
      <h2 id={`${testId}-h`} className="m-0 mb-2 text-[13px] font-bold uppercase tracking-wide text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}

// Label above value rather than beside it. A two-column row forces a long
// address or a long email to either overflow or truncate at 320px.
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="text-[11.5px] text-ink-muted">{label}</div>
      <div className="break-words text-[13.5px] font-semibold leading-snug text-ink">{value}</div>
    </div>
  );
}

function Money({ label, value, strong = false }: { label: string; value: string | number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'mt-1 border-t border-line-soft pt-1.5 text-[14px] font-bold text-ink' : 'text-[12.5px] text-ink-body'}`}>
      <span>{label}</span><span>{php(value)}</span>
    </div>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const { data, isLoading } = useOrderDetail(id);
  const { user, loading: isCheckingSession } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // The status emails link straight at this page, and it needs a session — so
  // most people arriving here are doing it days later, from a phone, with a
  // cookie that has expired.
  //
  // Without this the request 401s, `data` stays undefined, and the guard below
  // cannot tell "still fetching" from "will never arrive": the customer sits on
  // the loading line forever with nothing to click. Send them to log in instead,
  // carrying the way back, so the order they came for is what they land on.
  useEffect(() => {
    if (isCheckingSession || user) return;
    router.replace(`/login?next=${encodeURIComponent(`/orders/${id}`)}`);
  }, [isCheckingSession, user, id, router]);

  const save = async (items: OrderItemDraft[]) => {
    setIsSaving(true);
    try {
      await apiSend(`/orders/${id}`, 'PATCH', { items });
      // Both caches: the list screen shows each order's total, and leaving it
      // stale means the customer sees two different figures for one order.
      await qc.invalidateQueries({ queryKey: ['order', id] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      setIsEditing(false);
      toast('Order updated — we emailed you the revised receipt.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update your order.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !data) {
    return (
      <>
        <BackHeader title="Order details" onBack={() => router.push('/orders')} />
        <div className="p-10 text-center text-[13px] text-ink-muted">Loading…</div>
      </>
    );
  }

  const { order, customer, items, proofUrl, proofs = [] } = data;
  const downpayment = Number(order.downpaymentPhp ?? 0);
  const shipping = Number(order.shippingPhp ?? 0);
  // The same rule the server enforces (lib/order-edit.ts), so the button is
  // offered exactly when PATCH would accept it.
  const editability = customerEditability(order, order.settlementStatus ?? null);

  return (
    <>
      {/* An explicit destination, not router.back(). Arriving here from a
          shared link or a fresh tab leaves history empty, and back() then goes
          nowhere — the same dead end checkout used to have. */}
      <BackHeader title="Order details" onBack={() => router.push('/orders')} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4 md:p-6">

        <Section title="Order information" testId="order-block">
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <span className="font-display text-[18px] font-bold text-ink">{order.orderNo}</span>
            <span className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${STATUS_BADGE[order.status] || ''}`}>
              {STATUS_LABEL[order.status] ?? order.status}
            </span>
          </div>
          <Field label="Placed on" value={shortDate(order.createdAt)} />
          <div className="mt-3"><OrderStatusTrail status={order.status} /></div>
        </Section>

        <Section title="Customer information" testId="customer-block">
          <Field label="Name" value={customer.name ?? order.shipName} />
          <Field label="Contact number" value={customer.phone ?? order.shipPhone} />
          <Field label="Email" value={customer.email ?? '—'} />
        </Section>

        <Section title="Shipping information" testId="shipping-block">
          <Field label="Delivery address" value={order.shipAddress} />
          <Field label="Courier" value={order.courier || 'To be assigned'} />
          {/* Named as absent rather than left blank: an empty row reads as a
              rendering failure, and the customer cannot tell which it is. */}
          <Field label="Tracking number" value={order.trackingNo || 'Not yet assigned'} />
        </Section>

        <Section title={`Ordered items (${items.length})`} testId="items-block">
          {isEditing ? (
            <OrderItemsEditor
              items={items}
              isSaving={isSaving}
              onCancel={() => setIsEditing(false)}
              onSave={save}
            />
          ) : (
            <>
              <OrderItemList items={items} />
              {/* Only while the order is genuinely still changeable. When it is
                  not, the reason is stated rather than the button silently
                  missing — "why can't I fix this" is the support message this
                  whole feature exists to stop. */}
              {editability === 'editable' ? (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="mt-3 w-full rounded-[12px] border-[1.5px] border-line bg-white py-2.5 text-[13.5px] font-semibold text-ink-body transition-colors hover:border-brand-green hover:text-brand-greendark"
                >
                  ✏️ Edit items
                </button>
              ) : (
                <p data-testid="order-edit-blocked" className="mt-3 text-[11.5px] leading-snug text-ink-muted">
                  {EDIT_BLOCKED_MESSAGE[editability]}
                </p>
              )}
            </>
          )}
        </Section>

        {order.notes && (
          <Section title="Your note" testId="note-block">
            <p className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-body">{order.notes}</p>
          </Section>
        )}

        <Section title="Payment" testId="payment-block">
          <Field label="Method" value={order.paymentMethod || 'Not recorded'} />
          <Field label="Status" value={STATUS_LABEL[order.status] ?? order.status} />
          <Field label="Amount" value={php(order.totalPhp)} />
          {/* Every proof, plus a way to add one the customer only paid later.
              A bank that caps each transfer turns one order into several
              payments, and until this was here the second one had nowhere to go
              short of placing a duplicate order. Falls back to the legacy single
              key for orders written before order_payment_proofs existed. */}
          <div className="mt-3 border-t border-line-soft pt-3">
            <OrderProofSection
              orderId={order.id}
              status={order.status}
              proofs={proofs.length > 0 || !proofUrl ? proofs : [
                { id: 'legacy', url: proofUrl, sortOrder: 0, amountPhp: null, reference: null },
              ]}
            />
          </div>
        </Section>

        <Section title="Order summary" testId="summary-block">
          <Money label="Product subtotal" value={order.subtotalPhp} />
          {shipping > 0 && <Money label="Shipping fee" value={shipping} />}
          {Number(order.packingFeePhp) > 0 && <Money label="Packing fee" value={order.packingFeePhp} />}
          {downpayment > 0 && <Money label="Packing fee paid" value={downpayment} />}
          <Money label="Grand total" value={order.totalPhp} strong />
        </Section>

        <button onClick={() => router.push('/shop')}
          className="rounded-[12px] border-[1.5px] border-line bg-white py-3 text-[14px] font-semibold text-ink-body transition-colors hover:border-brand-green hover:text-brand-greendark">
          Continue shopping
        </button>
      </div>
    </>
  );
}
