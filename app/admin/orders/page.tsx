'use client';
import { useState } from 'react';
import { useAdminOrders, useAdminOrder, useMutate } from '@/lib/admin-api';
import { Modal, field, label, btnPrimary, btnGhost } from '@/components/admin-ui';
import { php, shortDate } from '@/lib/format';
import { reconcileProofs } from '@/lib/proof-reconciliation';
import { STATUS_FLOW, STATUS_LABEL, STATUS_BADGE } from '@/lib/order-status';
import { PACKERS, COURIERS } from '@/lib/report/constants';
import { WeeklyReportButton } from './WeeklyReportButton';
import type { OrderItem } from '@/lib/types';

const FILTERS = [['', 'All'], ['proof_review', 'Proof review'], ['payment_confirmed', 'Confirmed'], ['batch_filling', 'Filling'], ['shipped', 'Shipped'], ['delivered', 'Delivered']] as const;

type EditableLine = Pick<OrderItem, 'nameSnapshot' | 'specSnapshot' | 'qty'> & { id?: string; unitPricePhp: number };

function OrderItemsEditor({ orderId, status, items, onSaved }: {
  orderId: string; status: string; items: OrderItem[]; onSaved: () => void;
}) {
  const { editOrderItems } = useMutate();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EditableLine[]>(() => items.map((item) => ({
    id: item.id, nameSnapshot: item.nameSnapshot, specSnapshot: item.specSnapshot,
    qty: item.qty, unitPricePhp: Number(item.unitPricePhp),
  })));
  const [error, setError] = useState<string | null>(null);
  const locked = ['shipped', 'delivered', 'cancelled'].includes(status);
  const update = (index: number, patch: Partial<EditableLine>) =>
    setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));

  const save = async () => {
    setError(null);
    if (!rows.length) {
      setError('An order must keep at least one item. Cancel the order instead.');
      return;
    }
    try {
      await editOrderItems.mutateAsync({ id: orderId, items: rows });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not edit the items.');
    }
  };

  if (!editing) return (
    <button type="button" disabled={locked} onClick={() => setEditing(true)}
      className={`${btnGhost} mt-3 w-full disabled:cursor-not-allowed disabled:opacity-50`}>
      {locked ? 'Items locked after fulfilment' : 'Edit, add, or delete items'}
    </button>
  );

  return (
    <div className="mt-3 rounded-[10px] border border-line-soft bg-surface-mist p-3">
      <div className="mb-2 text-[12px] font-bold text-ink">Edit order items</div>
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <div key={row.id ?? `new-${index}`} className="grid grid-cols-[1fr_70px_92px_30px] gap-1.5">
            <input aria-label={`Item ${index + 1} name`} className={field} value={row.nameSnapshot}
              onChange={(e) => update(index, { nameSnapshot: e.target.value })} placeholder="Item name" />
            <input aria-label={`Item ${index + 1} quantity`} className={field} type="number" min={1} value={row.qty}
              onChange={(e) => update(index, { qty: Number(e.target.value) })} />
            <input aria-label={`Item ${index + 1} unit price`} className={field} type="number" min={0} step="0.01" value={row.unitPricePhp}
              onChange={(e) => update(index, { unitPricePhp: Number(e.target.value) })} />
            <button type="button" aria-label={`Delete item ${index + 1}`} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              className="rounded-md text-lg text-[#a33] hover:bg-[#fdeaea]">×</button>
          </div>
        ))}
      </div>
      <button type="button" className="mt-2 text-[12px] font-semibold text-brand-blue" onClick={() => setRows((current) => [...current, {
        nameSnapshot: '', specSnapshot: null, qty: 1, unitPricePhp: 0,
      }])}>+ Add item</button>
      <p className="mt-2 text-[11px] text-ink-muted">Totals recalculate automatically. New free-text lines are recorded as manual admin adjustments.</p>
      {error && <p role="alert" className="mt-2 text-[12px] text-[#a33]">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={() => setEditing(false)}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={editOrderItems.isPending} onClick={save}>
          {editOrderItems.isPending ? 'Saving…' : 'Save items'}
        </button>
      </div>
    </div>
  );
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useAdminOrder(id);
  const { setOrderStatus } = useMutate();
  const [status, setStatus] = useState('');
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const [courier, setCourier] = useState('');
  const [packedBy, setPackedBy] = useState('');
  const [payment, setPayment] = useState('');
  // A rejected update must show its reason here in the sheet — silently keeping
  // it open reads as a broken Save button.
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !data) return <Modal title="Order" onClose={onClose}><div className="py-6 text-ink-muted">Loading…</div></Modal>;
  // `proofs` is the full set; `proofUrl` is the legacy single key, still read as
  // a fallback so an order written before order_payment_proofs existed and
  // never backfilled still shows its screenshot.
  const { order, items, customer, proofUrl, proofs = [] } = data;
  const gallery = proofs.length > 0
    ? proofs
    : proofUrl ? [{ id: 'legacy', url: proofUrl, sortOrder: 0, amountPhp: null, reference: null }] : [];

  const save = async () => {
    setError(null);
    try {
      await setOrderStatus.mutateAsync({
        id: order.id, status: status || order.status, trackingNo: tracking || undefined, note: note || undefined,
        courier: courier || undefined, packedBy: packedBy || undefined, paymentMethod: payment || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the order.');
    }
  };

  return (
    <Modal title={`Order ${order.orderNo}`} onClose={onClose}>
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="mb-3 flex items-center gap-2">
          <span className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${STATUS_BADGE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
          <span className="text-[12px] text-ink-muted">{shortDate(order.createdAt)} · {order.buyType}</span>
        </div>
        <div className="rounded-[10px] bg-surface-mist p-3 text-[13px]">
          <div className="font-semibold text-ink">{customer.name} · {customer.phone}</div>
          <div className="text-ink-muted">{customer.email}</div>
          <div className="mt-1 text-ink-body">{order.shipAddress}</div>
        </div>

        {/* The customer's own instructions, distinct from the admin note on the
            status update below. Placed above the items because it may change how
            the parcel gets packed, and an admin who reads it after packing has
            read it too late. */}
        {order.notes && (
          <div className="mt-3 rounded-[10px] border-[1.5px] border-warn-softln bg-warn-softbg p-3">
            <div className="mb-1 text-[12px] font-bold text-[#8a6400]">📝 Customer note</div>
            <p className="m-0 whitespace-pre-wrap text-[13px] leading-snug text-[#6b5a24]">{order.notes}</p>
          </div>
        )}

        <div className="mt-3">
          {items.map((it) => (
            <div key={it.id} className="flex justify-between border-b border-line-soft py-2 text-[13px]">
              <span className="text-ink">{it.nameSnapshot} <span className="text-ink-muted">×{it.qty}</span></span>
              <strong>{php(it.lineTotalPhp)}</strong>
            </div>
          ))}
          <div className="flex justify-between pt-2 text-[13px] text-ink-body"><span>Subtotal</span><span>{php(order.subtotalPhp)}</span></div>
          {(() => {
            // New orders carry a single packing fee; legacy orders sum shipping + repack.
            const packing = Number(order.packingFeePhp ?? 0) || (Number(order.shippingPhp ?? 0) + Number(order.repackFeePhp ?? 0));
            return packing > 0
              ? <div className="flex justify-between text-[13px] text-ink-body"><span>Packing fee (local shipping incl.)</span><span>{php(packing)}</span></div>
              : null;
          })()}
          <div className="flex justify-between pt-1 text-[15px] font-bold"><span>Total</span><span className="font-display">{php(order.totalPhp)}</span></div>
          {(() => {
            // Kahati orders reserve slots with a downpayment; the balance is collected after the kahati ends.
            const downpayment = Number(order.downpaymentPhp ?? 0);
            if (downpayment <= 0) return null;
            const balance = Number(order.totalPhp) - downpayment;
            return (
              <div className="mt-1 rounded-[10px] bg-[#f2f8ec] px-3 py-2 text-[13px]">
                <div className="flex justify-between font-bold text-brand-greendark"><span>Packing fee paid</span><span>{php(downpayment)}</span></div>
                {balance > 0 && <div className="flex justify-between text-ink-body"><span>Balance to collect</span><span>{php(balance)}</span></div>}
              </div>
            );
          })()}
          <OrderItemsEditor orderId={order.id} status={order.status} items={items} onSaved={onClose} />
        </div>

        <div className="mt-3">
          <div className="mb-1.5 text-[12px] font-semibold text-ink-body">
            Payment proof{gallery.length > 1 ? ` — ${gallery.length} transfers` : ''}
          </div>
          {gallery.length > 0
            // Thumbnails rather than a link per proof: the admin is checking
            // these against a bank statement, and three identical "View proof"
            // links tell them nothing about which is which. Each opens full size.
            ? (
              <>
                <ul className="flex flex-wrap gap-2.5">
                  {gallery.map((proof, i) => (
                    <li key={proof.id}>
                      <ProofCard orderId={order.id} proof={proof} index={i} />
                    </li>
                  ))}
                </ul>
                <ProofReconciliation proofs={gallery} totalPhp={order.totalPhp} />
              </>
            )
            // A kahati order whose downpayment was waived collected nothing, so
            // no proof exists to attach. Said plainly, or this reads as a
            // customer who skipped payment and sends the admin chasing a
            // screenshot that was never supposed to exist.
            : order.buyType === 'kahati' && Number(order.downpaymentPhp ?? 0) === 0
              ? <span className="text-[13px] text-ink-muted">No payment was due — this customer already had a kahati commitment in progress, so no downpayment was collected. The full amount is billed at their final checkout.</span>
              : <span className="text-[13px] text-ink-muted">No proof attached.</span>}
        </div>

        <div className="mt-4 rounded-[10px] border border-line-soft p-3">
          <div className="mb-2 text-[13px] font-bold text-ink">Update status</div>
          <div className="grid grid-cols-2 gap-2">
            <select className={field} value={status || order.status} onChange={(e) => setStatus(e.target.value)}>
              {[...STATUS_FLOW, 'cancelled'].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <input className={field} placeholder="Tracking no (LBC…)" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </div>
          <input className={`${field} mt-2`} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-1.5 text-[11.5px] text-ink-muted">Customer gets an email notification on status change.</div>

          <div className="mt-3 border-t border-line-soft pt-3">
            <div className="mb-2 text-[12px] font-bold text-ink">Weekly report fields</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className={label}>Shipping</span>
                <input className={field} list="courier-list" placeholder="J&T" value={courier || order.courier || ''} onChange={(e) => setCourier(e.target.value)} />
                <datalist id="courier-list">{COURIERS.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <span className={label}>Admin</span>
                <select className={field} value={packedBy || order.packedBy || ''} onChange={(e) => setPackedBy(e.target.value)}>
                  <option value="">—</option>
                  {PACKERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <span className={label}>Payment</span>
                <input className={field} placeholder="BDO / GoTyme" value={payment || order.paymentMethod || ''} onChange={(e) => setPayment(e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Close</button>
        <button className={btnPrimary} disabled={setOrderStatus.isPending} onClick={save}>{setOrderStatus.isPending ? 'Saving…' : 'Save update'}</button>
      </div>
    </Modal>
  );
}

// One proof, with the box the admin types its amount into.
//
// Editing lives on the thumbnail rather than in a separate form because the
// admin is doing one thing: looking at a screenshot and writing down what it
// says. Splitting the picture from the field would make them hold a figure in
// their head while they scroll.
function ProofCard({ orderId, proof, index }: {
  orderId: string;
  proof: { id: string; url: string; amountPhp: string | null };
  index: number;
}) {
  const { setProofAmount } = useMutate();
  const stored = proof.amountPhp ?? '';
  const [value, setValue] = useState(stored);

  // Saved on blur, not on every keystroke: a per-character PATCH would put a
  // dozen writes behind one four-digit figure. Unchanged blurs write nothing,
  // so a stray click costs a request.
  const commit = () => {
    if (value === stored) return;
    const amountPhp = value.trim() === '' ? null : Number(value);
    if (amountPhp != null && !Number.isFinite(amountPhp)) return;
    setProofAmount.mutateAsync({ orderId, proofId: proof.id, amountPhp }).catch(() => {});
  };

  return (
    <div className="w-[124px] overflow-hidden rounded-[10px] border border-line">
      <a href={proof.url} target="_blank" rel="noreferrer" className="block hover:opacity-90">
        <img src={proof.url} alt={`Payment proof ${index + 1}`} className="h-[104px] w-full bg-surface-mist object-cover" />
        <span className="block px-2 pt-1.5 text-[12px] font-semibold text-brand-blue">Proof #{index + 1}</span>
      </a>
      <label className="block px-2 pb-2 pt-1">
        <span className="sr-only">{`Amount for proof ${index + 1}`}</span>
        <input
          type="number"
          min={0}
          inputMode="decimal"
          placeholder="Amount ₱"
          aria-label={`Amount for proof ${index + 1}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          className="w-full rounded-md border border-line-soft px-1.5 py-1 text-[12px] text-ink"
        />
      </label>
    </div>
  );
}

// Does what is recorded add up to what is owed?
//
// The question §13 is actually asking. Three thumbnails and a bank statement
// should not require the admin to do the sum in their head, and "unrecorded" is
// kept distinct from "short" — every fresh order has no amounts against it, and
// showing those as underpaid would make the line worth ignoring.
function ProofReconciliation({ proofs, totalPhp }: {
  proofs: { amountPhp: string | null }[];
  totalPhp: string;
}) {
  const r = reconcileProofs(proofs, totalPhp);
  if (r.state === 'unrecorded') {
    return (
      <p className="mt-2 text-[12px] text-ink-muted">
        No amounts recorded yet — type what each transfer was worth to check this order adds up.
      </p>
    );
  }
  const tone =
    r.state === 'settled' ? 'text-brand-greendark'
    : r.state === 'over' ? 'text-[#8a6d1f]'
    : 'text-[#a33]';
  const verdict =
    r.state === 'settled' ? 'fully paid'
    : r.state === 'over' ? `overpaid by ${php(Math.abs(r.outstanding))}`
    : `${php(r.outstanding)} short`;
  return (
    <p className={`mt-2 text-[12.5px] font-semibold ${tone}`}>
      {php(r.recorded)} of {php(totalPhp)} recorded — {verdict}
      {r.unrecordedCount > 0 && (
        <span className="block font-normal text-ink-muted">
          {r.unrecordedCount} proof{r.unrecordedCount > 1 ? 's' : ''} still without an amount.
        </span>
      )}
    </p>
  );
}

export default function AdminOrdersPage() {
  const [filter, setFilter] = useState('');
  const { data: orders = [], isLoading } = useAdminOrders(filter || undefined);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Orders</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Verify proofs, update status &amp; add tracking.</p>
        </div>
        <WeeklyReportButton />
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([val, lbl]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${filter === val ? 'bg-brand-navy text-white' : 'bg-white text-ink-body'}`}>{lbl}</button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
        <table className="w-full min-w-[680px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr><th className="px-4 py-3">Order</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th></tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={6}>Loading…</td></tr> :
              orders.length ? orders.map((o) => (
                <tr key={o.id} onClick={() => setSelected(o.id)} className="cursor-pointer border-b border-line-soft/60 hover:bg-surface-mist">
                  <td className="px-4 py-3 font-semibold text-ink">{o.orderNo}</td>
                  <td className="px-4 py-3 text-ink-body">{o.shipName}<div className="text-[11px] text-ink-muted">{(o as any).customerEmail}</div></td>
                  <td className="px-4 py-3"><span className="rounded bg-surface-mist px-2 py-0.5 text-[11px] font-semibold text-ink-body">{o.buyType}</span></td>
                  <td className="px-4 py-3 font-display font-bold">{php(o.totalPhp)}</td>
                  <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[o.status]}`}>{STATUS_LABEL[o.status]}</span></td>
                  <td className="px-4 py-3 text-ink-muted">{shortDate(o.createdAt)}</td>
                </tr>
              )) : <tr><td className="px-4 py-6 text-ink-muted" colSpan={6}>No orders.</td></tr>}
          </tbody>
        </table>
      </div>
      {selected && <OrderDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
