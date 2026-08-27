'use client';
import { useState } from 'react';
import { useAdminGroupBuys, useAdminGroupBuyCommitments, useMutate } from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost, btnBoardAction, searchInput } from '@/components/admin-ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { php } from '@/lib/format';
import { KAHATI_MAX_VIALS, kahatiProgressPercent, kahatiClaimedDisplay } from '@/lib/kahati';
import { perVialPrice } from '@/lib/pricing';
import { hatianBatchSummary } from '@/lib/hatian-batch-summary';
import { STATUS_LABEL } from '@/lib/order-status';
import type { GroupBuy, HatianCommitment, PaymentState } from '@/lib/types';

// A brand-new hatian starts empty and fills exactly one kit.
// A brand-new hatian opens on save unless the admin gives it an open date.
const blank = (): Partial<GroupBuy> => ({ name: '', pricePerKitPhp: '0', totalSlots: KAHATI_MAX_VIALS, claimedSlots: 0, minVials: 1, repackFeePhp: '150', status: 'open', arrivalGroup: 'white_powder', opensAt: null, closesAt: null });

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
        opensAt: f.opensAt ?? null,
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
            {['scheduled', 'open', 'closed', 'shipped', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Labeled>
        <div className="col-span-2">
          <Labeled label="Opens at (leave blank to open now)">
            <input className={field} type="datetime-local" aria-label="Opens at"
              value={toLocalInput(f.opensAt)} onChange={(e) => setF({ ...f, opensAt: toIso(e.target.value) })} />
          </Labeled>
        </div>
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
// Which hatian this is, stated before the money. Counters that filled roll into
// same-named siblings, so "Bioglutide" alone does not identify the one whose
// participants are listed below — the status and the fill do.
function GroupBuyDetails({ groupBuy }: { groupBuy: GroupBuy }) {
  const claimed = kahatiClaimedDisplay(groupBuy.claimedSlots, groupBuy.totalSlots);
  const progress = kahatiProgressPercent(claimed, groupBuy.totalSlots);
  return (
    <section data-testid="group-buy-details" aria-label="Group buy details" className="mb-4 rounded-[12px] border border-line-soft bg-surface-mist px-4 py-3">
      <h3 className="m-0 mb-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">Group buy details</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <Detail label="Campaign name"><span className="font-semibold text-ink">{groupBuy.name}</span></Detail>
        <Detail label="Status">
          <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${groupBuy.status === 'open' ? 'bg-[#e8f5db] text-brand-greendark' : groupBuy.status === 'cancelled' ? 'bg-[#fbe4e4] text-[#b23b3b]' : 'bg-line text-ink-body'}`}>{groupBuy.status}</span>
        </Detail>
        <Detail label="Price per vial"><span className="text-ink-body">{php(groupBuy.pricePerKitPhp)}/kit</span></Detail>
        <div className="col-span-2 sm:col-span-3">
          <Detail label="Current progress">
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#edf2ea]">
              <div className="h-full bg-gradient-to-r from-brand-blue to-brand-green" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-1 text-[12px] font-semibold text-brand-greendark">
              {claimed}/{groupBuy.totalSlots} vials · {progress}% of the kit
            </div>
          </Detail>
        </div>
      </dl>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="m-0 mt-0.5 text-[13px]">{children}</dd>
    </div>
  );
}

// A proof the admin can scan down the column, and enlarge when a thumbnail is
// too small to read a reference number off. Dimensions are explicit: a column of
// proofs loading at their natural size reflows the table under the cursor.
const PROOF_THUMB_PX = 44;

function ProofCell({ row, onOpen }: { row: HatianCommitment; onOpen: () => void }) {
  if (!row.proofUrl) {
    return (
      <td data-testid={`proof-cell-${row.orderId}`} className="py-2.5 text-[11px] text-ink-faint">
        No proof
      </td>
    );
  }
  return (
    <td data-testid={`proof-cell-${row.orderId}`} className="py-2.5">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View proof of payment from ${row.customerName}`}
        className="block overflow-hidden rounded-[8px] border border-line-soft transition-transform duration-150 ease-out hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
      >
        <img
          data-testid={`proof-${row.orderId}`}
          src={row.proofUrl}
          alt={`Payment proof from ${row.customerName}`}
          width={PROOF_THUMB_PX}
          height={PROOF_THUMB_PX}
          loading="lazy"
          className="h-[44px] w-[44px] object-cover"
        />
      </button>
    </td>
  );
}

// The enlarged proof. Its own layer above the panel rather than a replacement
// for it — the admin closes it and is still on the same row of the same batch.
function ProofLightbox({ row, onClose }: { row: HatianCommitment; onClose: () => void }) {
  return (
    <div
      data-testid="proof-lightbox"
      role="dialog"
      aria-label={`Proof of payment from ${row.customerName}`}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6"
    >
      <figure onClick={(e) => e.stopPropagation()} className="m-0 max-h-full max-w-[min(900px,92vw)] overflow-auto rounded-[14px] bg-white p-3 shadow-card">
        <img
          data-testid="proof-lightbox-image"
          src={row.proofUrl ?? ''}
          alt={`Payment proof from ${row.customerName}`}
          className="block max-h-[70vh] w-auto max-w-full rounded-[8px] object-contain"
        />
        <figcaption className="mt-2 flex items-center justify-between gap-4 text-[12.5px] text-ink-body">
          <span>
            <strong className="text-ink">{row.customerName}</strong> · {row.orderNo}
            {row.paymentMethod && <> · {row.paymentMethod}</>}
          </span>
          <button className={btnGhost} onClick={onClose} aria-label="Close proof">Close proof</button>
        </figcaption>
      </figure>
    </div>
  );
}

// What the batch adds up to. The arithmetic lives in lib/hatian-batch-summary —
// the two traps in it (double-counted shared balances, cancelled orders) are
// worth a tested module rather than a handful of reduces inline here.
function BatchSummary({ rows, groupBuy }: { rows: HatianCommitment[]; groupBuy: GroupBuy }) {
  const s = hatianBatchSummary(rows, {
    totalSlots: groupBuy.totalSlots,
    // Derived, not read off the row: the admin feed returns raw group_buys and
    // never computes perVialPhp, so trusting that field would put undefined
    // through the money formatter — the exact shape of the crash this panel
    // was fixed for.
    perVialPhp: perVialPrice(Number(groupBuy.pricePerKitPhp)),
  });
  const figures: { label: string; value: string; testId: string; tone?: string }[] = [
    { label: 'Total participants', value: String(s.totalParticipants), testId: 'summary-participants' },
    { label: 'Vials reserved', value: String(s.totalVialsReserved), testId: 'summary-vials-reserved' },
    { label: 'Vials remaining', value: String(s.remainingVials), testId: 'summary-vials-remaining' },
    { label: 'Gross income', value: php(s.grossIncomePhp), testId: 'summary-gross-income', tone: 'text-brand-greendark' },
    { label: 'Confirmed payments', value: String(s.confirmedPayments), testId: 'summary-confirmed', tone: 'text-brand-greendark' },
    { label: 'Pending payments', value: String(s.pendingPayments), testId: 'summary-pending', tone: 'text-[#8a6d1f]' },
    { label: 'Cancelled orders', value: String(s.cancelledOrders), testId: 'summary-cancelled', tone: 'text-[#b23b3b]' },
  ];
  return (
    <section data-testid="batch-summary" aria-label="Batch summary" className="mt-4 rounded-[12px] border border-line-soft bg-surface-mist px-4 py-3">
      <h3 className="m-0 mb-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">Batch summary</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {figures.map((f) => (
          <div key={f.testId}>
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{f.label}</dt>
            <dd data-testid={f.testId} className={`m-0 mt-0.5 font-display text-[17px] font-bold ${f.tone ?? 'text-ink'}`}>{f.value}</dd>
          </div>
        ))}
      </dl>
      {/* Said out loud, because it is the difference between ordering 5 vials
          from the supplier and ordering 9. */}
      {s.cancelledOrders > 0 && (
        <p className="mt-2.5 mb-0 text-[11.5px] text-ink-muted">
          Cancelled orders are excluded from the vials reserved and the gross income.
        </p>
      )}
    </section>
  );
}

function ParticipantsPanel({ groupBuy, onClose }: { groupBuy: GroupBuy; onClose: () => void }) {
  const { data: rows = [], isLoading } = useAdminGroupBuyCommitments(groupBuy.id);
  const [proof, setProof] = useState<HatianCommitment | null>(null);

  return (
    <Modal title={`Participants & payments — ${groupBuy.name}`} onClose={onClose}>
      <div className="max-h-[70vh] overflow-y-auto">
        {/* Outside the loading/empty branches: which hatian this is does not
            depend on whether anyone has joined it, and an admin who opened the
            wrong counter needs to see that immediately. */}
        <GroupBuyDetails groupBuy={groupBuy} />
        {isLoading ? <div className="py-6 text-ink-muted">Loading…</div> : rows.length === 0 ? (
          <div className="py-6 text-[13px] text-ink-muted">Walang sumali pa sa hatian na ito.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-[12.5px]">
                <thead className="border-b border-line-soft text-[11px] uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="py-2 pr-3">Customer</th>
                    <th className="py-2 pr-3">Contact</th>
                    <th className="py-2 pr-3">Shipping address</th>
                    <th className="py-2 pr-3">Vials</th>
                    <th className="py-2 pr-3">Paid</th>
                    <th className="py-2 pr-3">Balance</th>
                    <th className="py-2 pr-3">Method</th>
                    <th className="py-2 pr-3">Order</th>
                    <th className="py-2 pr-3">Downpayment</th>
                    <th className="py-2 pr-3">Final payment</th>
                    <th className="py-2 pr-3">Packing fee</th>
                    <th className="py-2 pr-3">Committed</th>
                    <th className="py-2">Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: HatianCommitment) => (
                    <tr key={r.orderId} className="border-b border-line-soft/60 transition-colors duration-150 hover:bg-surface-mist/60">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-ink">{r.customerName}</div>
                        <div className="text-[11px] text-ink-muted">{r.customerEmail}</div>
                        <div className="text-[11px] text-ink-muted">{r.orderNo}</div>
                      </td>
                      <td data-testid={`contact-${r.orderId}`} className="py-2.5 pr-3 whitespace-nowrap text-ink-body">{r.contactPhone}</td>
                      <td data-testid={`address-${r.orderId}`} className="min-w-[180px] max-w-[240px] py-2.5 pr-3 text-[11.5px] text-ink-body">{r.shippingAddress}</td>
                      <td data-testid={`vials-${r.orderId}`} className="py-2.5 pr-3 font-bold text-ink">{r.vials}</td>
                      <td data-testid={`amount-paid-${r.orderId}`} className="py-2.5 pr-3 font-semibold text-brand-greendark">{php(r.amountPaidPhp)}</td>
                      <td data-testid={`balance-${r.orderId}`} className="py-2.5 pr-3 font-semibold text-ink">
                        {php(r.orderBalancePhp)}
                        {/* The figure belongs to the whole order, so an overflow
                            commitment shows it under both counters. Say so — the
                            column does not add up, and an admin chasing money
                            needs to know that before totalling it. */}
                        {r.spansOtherHatians && (
                          <div className="text-[11px] font-normal text-ink-muted">also in another hatian</div>
                        )}
                      </td>
                      <td data-testid={`payment-method-${r.orderId}`} className="py-2.5 pr-3 whitespace-nowrap text-ink-body">
                        {r.paymentMethod ?? <span className="text-ink-faint">—</span>}
                      </td>
                      <td data-testid={`order-status-${r.orderId}`} className="py-2.5 pr-3 whitespace-nowrap text-ink-body">
                        {STATUS_LABEL[r.orderStatus] ?? r.orderStatus}
                      </td>
                      <td className="py-2.5 pr-3"><PaymentBadge state={r.downpayment} testId={`downpayment-${r.orderId}`} /></td>
                      <td className="py-2.5 pr-3"><PaymentBadge state={r.finalPayment} testId={`final-payment-${r.orderId}`} /></td>
                      <td className="py-2.5 pr-3"><PaymentBadge state={r.packingFee} testId={`packing-fee-${r.orderId}`} /></td>
                      <td data-testid={`committed-at-${r.orderId}`} className="py-2.5 pr-3 whitespace-nowrap text-ink-body">
                        {commitStamp(r.committedAt)}
                      </td>
                      <ProofCell row={r} onOpen={() => setProof(r)} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <BatchSummary rows={rows} groupBuy={groupBuy} />
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button className={btnGhost} onClick={onClose}>Close</button>
      </div>
      {proof && <ProofLightbox row={proof} onClose={() => setProof(null)} />}
    </Modal>
  );
}

export default function AdminGroupBuysPage() {
  const { data: gbs = [], isLoading } = useAdminGroupBuys();
  const { deleteGroupBuy, saveGroupBuy, startKahatiCycle } = useMutate();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<GroupBuy> | null>(null);
  const [viewing, setViewing] = useState<GroupBuy | null>(null);

  const [search, setSearch] = useState('');

  // The counters this control will actually end.
  //
  // Open AND joined, matching rollOpenKahatis's own skip rule: the server leaves
  // a counter nobody has joined alone, so counting every open row told the admin
  // five were ending when two were — and on the board a cycle has just left
  // behind (every counter open, none joined) it offered a button that would do
  // nothing at all.
  //
  // Counted off the whole board, never off `shown`: the cycle acts on every such
  // counter there is, so an admin who narrowed the view to one name must still
  // be told how many the button will move.
  const running = gbs.filter((g) => g.status === 'open' && g.claimedSlots > 0);

  // Every cycle seals each counter and opens a fresh one beside it, so the board
  // grows a same-named sibling per counter per cycle and finding one by eye
  // stops working quickly. Filtered here rather than at the API: the admin feed
  // returns the whole board already, so a round trip would buy nothing.
  const query = search.trim().toLowerCase();
  const shown = query ? gbs.filter((g) => g.name.toLowerCase().includes(query)) : gbs;

  // Ending every running counter at once — the start of a new trading cycle.
  // Confirmed, because customers are committed to these counters; deliberately
  // not worded as a warning, though, since the commitments stay with the counter
  // that took them and its successor opens in the same breath.
  const handleStartCycle = async () => {
    const ok = await confirm({
      title: `Start a new cycle across ${running.length} counter${running.length === 1 ? '' : 's'}?`,
      message: 'Every counter with vials on it closes and a fresh one opens in its place, ready to take the next cycle. Counters nobody has joined stay open. Customer orders are not changed — settle those on the orders screen.',
      confirmLabel: 'End all & start next',
      cancelLabel: 'Keep the board as it is',
    });
    if (ok) startKahatiCycle.mutate();
  };

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-[24px] font-bold">Group Buys</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Edit kahati prices, slots &amp; close orders.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-none">
          {running.length > 0 && (
            <button
              onClick={handleStartCycle}
              disabled={startKahatiCycle.isPending}
              className={btnBoardAction}
            >
              Start new cycle
            </button>
          )}
          <button className={btnPrimary} onClick={() => setEditing(blank())}>+ New group buy</button>
        </div>
      </div>

      {/* Nothing to search means nothing to search through. */}
      {gbs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search group buys"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={searchInput}
          />
          {/* Said out loud while filtered: the board is the admin's count of how
              many counters exist, and a narrowed view silently contradicts it. */}
          {query && (
            <span className="text-[12.5px] text-ink-muted">
              {shown.length} of {gbs.length} counters
            </span>
          )}
        </div>
      )}

      {/* A typo and an empty cycle look identical on a blank board, so the
          no-match state names what was searched for rather than showing nothing. */}
      {!isLoading && query && shown.length === 0 && (
        <div className="rounded-[16px] bg-white p-8 text-center shadow-card">
          <div className="mb-1 font-bold text-ink">No counter matches &ldquo;{search.trim()}&rdquo;</div>
          <div className="text-[13px] text-ink-muted">Check the spelling, or clear the search to see the whole board.</div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? <div className="text-ink-muted">Loading…</div> : shown.map((g) => {
          // Clamped so a row written before the database cap existed reads
          // "10/10 vials", never the "13/10" the business says cannot happen.
          const claimed = kahatiClaimedDisplay(g.claimedSlots, g.totalSlots);
          const progress = kahatiProgressPercent(claimed, g.totalSlots);
          return (
            <div key={g.id} className="rounded-[16px] bg-white p-4 shadow-card">
              <div className="flex items-start justify-between">
                <div className="font-bold text-ink">{g.name}</div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${g.status === 'open' ? 'bg-[#e8f5db] text-brand-greendark' : g.status === 'cancelled' ? 'bg-[#fbe4e4] text-[#b23b3b]' : 'bg-line text-ink-body'}`}>{g.status}</span>
              </div>
              <div className="mt-1 text-[12px] text-ink-muted">{php(g.pricePerKitPhp)}/kit · ₱{Number(g.pricePerKitPhp) / 10}/vial</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf2ea]"><div className="h-full bg-gradient-to-r from-brand-blue to-brand-green" style={{ width: `${progress}%` }} /></div>
              <div className="mt-1 text-[12px] font-semibold text-brand-greendark">{claimed}/{g.totalSlots} vials</div>
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
