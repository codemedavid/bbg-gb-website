'use client';
import { useState } from 'react';
import { useAdminGroupBuys, useAdminGroupBuyCommitments, useMutate } from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { php } from '@/lib/format';
import { KAHATI_MAX_VIALS, kahatiProgressPercent } from '@/lib/kahati';
import type { GroupBuy, HatianCommitment, PaymentState } from '@/lib/types';

// A brand-new hatian starts empty and fills exactly one kit.
const blank = (): Partial<GroupBuy> => ({ name: '', pricePerKitPhp: '0', totalSlots: KAHATI_MAX_VIALS, claimedSlots: 0, minVials: 1, repackFeePhp: '150', status: 'open', arrivalGroup: 'white_powder', closesAt: null });

// The hatian deadline drives the storefront "closes in …" countdown and the
// expiry sweep. Stored as an ISO string; the <input type="datetime-local">
// works in local time, so convert on the boundary.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toIso = (local: string): string | null => (local ? new Date(local).toISOString() : null);

function GroupBuyForm({ initial, onClose }: { initial: Partial<GroupBuy>; onClose: () => void }) {
  const { saveGroupBuy } = useMutate();
  const [f, setF] = useState<Partial<GroupBuy>>(initial);
  // A rejected save (over-cap counts, cap below claimed vials, …) must show its
  // reason here in the form — closing, or failing silently, would leave the
  // admin thinking the save worked or the button was broken.
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      await saveGroupBuy.mutateAsync({
        id: f.id, name: f.name, pricePerKitPhp: Number(f.pricePerKitPhp) as any,
        totalSlots: Number(f.totalSlots), claimedSlots: Number(f.claimedSlots), minVials: Number(f.minVials),
        repackFeePhp: Number(f.repackFeePhp) as any, status: f.status, arrivalGroup: f.arrivalGroup,
        closesAt: f.closesAt ?? null,
        description: f.description ?? null,
      } as any);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save group buy.');
    }
  };
  return (
    <Modal title={f.id ? 'Edit group buy' : 'New group buy'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Labeled label="Name"><input className={field} value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Labeled></div>
        <Labeled label="Price / kit ₱ (editable)"><input className={field} type="number" value={f.pricePerKitPhp as any} onChange={(e) => setF({ ...f, pricePerKitPhp: e.target.value })} /></Labeled>
        <Labeled label="Packing fee ₱ (local shipping incl.)"><input className={field} type="number" value={f.repackFeePhp as any} onChange={(e) => setF({ ...f, repackFeePhp: e.target.value })} /></Labeled>
        <Labeled label={`Vial cap (1 kit = ${KAHATI_MAX_VIALS})`}><input className={field} type="number" min={1} max={KAHATI_MAX_VIALS} value={f.totalSlots ?? KAHATI_MAX_VIALS} onChange={(e) => setF({ ...f, totalSlots: Number(e.target.value) })} /></Labeled>
        <Labeled label="Claimed vials"><input className={field} type="number" min={0} max={KAHATI_MAX_VIALS} value={f.claimedSlots ?? 0} onChange={(e) => setF({ ...f, claimedSlots: Number(e.target.value) })} /></Labeled>
        <Labeled label="Min vials / person"><input className={field} type="number" min={1} max={KAHATI_MAX_VIALS} value={f.minVials ?? 1} onChange={(e) => setF({ ...f, minVials: Number(e.target.value) })} /></Labeled>
        <Labeled label="Status">
          <select className={field} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as any })}>
            {['open', 'closed', 'shipped', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Labeled>
        <div className="col-span-2">
          <Labeled label="Closes at (deadline)">
            <input className={field} type="datetime-local" aria-label="Closes at"
              value={toLocalInput(f.closesAt)} onChange={(e) => setF({ ...f, closesAt: toIso(e.target.value) })} />
          </Labeled>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saveGroupBuy.isPending} onClick={submit}>{saveGroupBuy.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

// The three payments a hatian participant owes, each with its own state. Colour
// carries the meaning at a glance; the word carries it for everyone else.
const PAYMENT_BADGE: Record<PaymentState, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'bg-[#e8f5db] text-brand-greendark' },
  under_review: { label: 'Under review', className: 'bg-[#fdf3d8] text-[#8a6d1f]' },
  unpaid: { label: 'Unpaid', className: 'bg-[#fbe4e4] text-[#b23b3b]' },
  cancelled: { label: 'Cancelled', className: 'bg-line text-ink-body' },
};

function PaymentBadge({ state, testId }: { state: PaymentState; testId: string }) {
  const badge = PAYMENT_BADGE[state] ?? PAYMENT_BADGE.unpaid;
  return (
    <span data-testid={testId} className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${badge.className}`}>
      {badge.label}
    </span>
  );
}

// Commitment timestamps need the time, not just the date: two customers joining
// the same hatian on the same day is ordinary, and "who was first" is a question
// the admin gets asked when a batch is oversubscribed.
const commitStamp = (iso: string): string =>
  new Date(iso).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

// Who is in this hatian and what each of them still owes. The packing fee is no
// longer collected when a customer commits — it is charged once at their final
// checkout — so an admin chasing money needs the three payments side by side.
function ParticipantsPanel({ groupBuy, onClose }: { groupBuy: GroupBuy; onClose: () => void }) {
  const { data: rows = [], isLoading } = useAdminGroupBuyCommitments(groupBuy.id);
  const settled = rows.filter((r: HatianCommitment) => r.finalPayment === 'paid').length;

  return (
    <Modal title={`Participants — ${groupBuy.name}`} onClose={onClose}>
      <div className="max-h-[70vh] overflow-y-auto">
        {isLoading ? <div className="py-6 text-ink-muted">Loading…</div> : rows.length === 0 ? (
          <div className="py-6 text-[13px] text-ink-muted">Walang sumali pa sa hatian na ito.</div>
        ) : (
          <>
            <div data-testid="settled-count" className="mb-3 rounded-[10px] bg-surface-mist px-3 py-2 text-[12.5px] text-ink-body">
              <strong>{settled} of {rows.length}</strong> participant{rows.length === 1 ? '' : 's'} fully settled
              {settled < rows.length && ' — the rest still owe their final payment and packing fee.'}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[12.5px]">
                <thead className="border-b border-line-soft text-[11px] uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="py-2 pr-3">Customer</th>
                    <th className="py-2 pr-3">Vials</th>
                    <th className="py-2 pr-3">Committed</th>
                    <th className="py-2 pr-3">Balance</th>
                    <th className="py-2 pr-3">Downpayment</th>
                    <th className="py-2 pr-3">Final payment</th>
                    <th className="py-2">Packing fee</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: HatianCommitment) => (
                    <tr key={r.orderId} className="border-b border-line-soft/60">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-ink">{r.customerName}</div>
                        <div className="text-[11px] text-ink-muted">{r.customerEmail}</div>
                        <div className="text-[11px] text-ink-muted">{r.orderNo}</div>
                      </td>
                      <td data-testid={`vials-${r.orderId}`} className="py-2.5 pr-3 font-bold text-ink">{r.vials}</td>
                      <td data-testid={`committed-at-${r.orderId}`} className="py-2.5 pr-3 text-ink-body">
                        {commitStamp(r.committedAt)}
                      </td>
                      <td className="py-2.5 pr-3 font-semibold text-ink">{php(r.balancePhp)}</td>
                      <td className="py-2.5 pr-3"><PaymentBadge state={r.downpayment} testId={`downpayment-${r.orderId}`} /></td>
                      <td className="py-2.5 pr-3"><PaymentBadge state={r.finalPayment} testId={`final-payment-${r.orderId}`} /></td>
                      <td className="py-2.5"><PaymentBadge state={r.packingFee} testId={`packing-fee-${r.orderId}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button className={btnGhost} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export default function AdminGroupBuysPage() {
  const { data: gbs = [], isLoading } = useAdminGroupBuys();
  const { deleteGroupBuy, saveGroupBuy } = useMutate();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<GroupBuy> | null>(null);
  const [viewing, setViewing] = useState<GroupBuy | null>(null);

  const handleDelete = async (g: GroupBuy) => {
    const ok = await confirm({
      title: `Delete "${g.name}"?`,
      message: 'This permanently removes the group buy. This cannot be undone.',
      confirmLabel: 'Delete group buy',
    });
    if (ok) deleteGroupBuy.mutate(g.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Group Buys</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Edit kahati prices, slots &amp; close orders.</p>
        </div>
        <button className={btnPrimary} onClick={() => setEditing(blank())}>+ New group buy</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? <div className="text-ink-muted">Loading…</div> : gbs.map((g) => {
          const progress = kahatiProgressPercent(g.claimedSlots, g.totalSlots);
          return (
            <div key={g.id} className="rounded-[16px] bg-white p-4 shadow-card">
              <div className="flex items-start justify-between">
                <div className="font-bold text-ink">{g.name}</div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${g.status === 'open' ? 'bg-[#e8f5db] text-brand-greendark' : g.status === 'cancelled' ? 'bg-[#fbe4e4] text-[#b23b3b]' : 'bg-line text-ink-body'}`}>{g.status}</span>
              </div>
              <div className="mt-1 text-[12px] text-ink-muted">{php(g.pricePerKitPhp)}/kit · ₱{Number(g.pricePerKitPhp) / 10}/vial</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf2ea]"><div className="h-full bg-gradient-to-r from-brand-blue to-brand-green" style={{ width: `${progress}%` }} /></div>
              <div className="mt-1 text-[12px] font-semibold text-brand-greendark">{g.claimedSlots}/{g.totalSlots} vials</div>
              <button onClick={() => setViewing(g)}
                className="mt-2 w-full rounded-[9px] bg-surface-mist py-1.5 text-[12.5px] font-semibold text-ink-body hover:bg-[#eaf0e6]">
                👥 Participants &amp; payments
              </button>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setEditing(g)} className="flex-1 rounded-[9px] border border-line py-1.5 text-[13px] font-semibold text-brand-blue">Edit</button>
                {g.status === 'open' && <button onClick={() => saveGroupBuy.mutate({ id: g.id, status: 'closed' } as any)} className="flex-1 rounded-[9px] border border-line py-1.5 text-[13px] font-semibold text-warn-fg">Close</button>}
                <button onClick={() => handleDelete(g)} className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] font-semibold text-[#b23b3b]">✕</button>
              </div>
            </div>
          );
        })}
      </div>
      {editing && <GroupBuyForm initial={editing} onClose={() => setEditing(null)} />}
      {viewing && <ParticipantsPanel groupBuy={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
