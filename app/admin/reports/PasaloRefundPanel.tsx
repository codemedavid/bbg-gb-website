'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, qs } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { field, btnPrimary, btnGhost, btnBoardAction } from '@/components/admin-ui';
import { php } from '@/lib/format';
import { REFUND_STATUS_BADGE, REFUND_STATUS_LABEL, type RefundStatus } from '@/lib/refund-status';
import type {
  BatchSummaryRow, BatchTotals, CounterOutcome, CustomerRefundRow, RefundRecord,
} from '@/lib/report/pasalo-refund';

// The Pasalo (Bunuan) control panel.
//
// Sits under the segment reports because it answers the question that comes
// after them: the batch closed, some products fell short, now who is owed what.
// It shares the page's date range — a refund belongs to one batch, and that
// batch is the window already chosen above.
//
// Three states in one panel, deliberately: the stage that is running, the
// determination a close produced, and the refunds still to send. Splitting them
// across screens would let an admin close a stage on one page and never see
// what it decided on another.

type PasaloReport = {
  from: string;
  to: string;
  board: CounterOutcome[];
  customers: CustomerRefundRow[];
  refunds: RefundRecord[];
  batch: BatchSummaryRow[];
  totals: BatchTotals;
};

const cell = 'px-2.5 py-2 text-[12.5px]';
const headCell = 'px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted';

export function PasaloRefundPanel({ from, to }: { from: string; to: string }) {
  const showToast = useToast((s) => s.show);
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [deadline, setDeadline] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'pasalo-refund', from, to],
    queryFn: () => apiGet<PasaloReport>(`/admin/report/pasalo-refund${qs({ from, to })}`),
    enabled: !!from && !!to && to >= from,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'pasalo-refund'] });

  const call = async (path: string, body?: unknown) => {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? 'Request failed.');
    return json.data;
  };

  const openStage = async () => {
    const ok = await confirm({
      title: 'End Kahati and open Pasalo?',
      message: `Only counters that started between ${from} and ${to} will move to Pasalo — anything from an `
        + 'earlier batch stays on the Kahati board. They keep selling on the deadline you set. '
        + 'Nothing is cancelled and nobody is refunded — that only happens when you close the stage.',
      confirmLabel: 'Open Pasalo',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    setBusy('open');
    try {
      const result = await call('/admin/groupbuys/pasalo', {
        closesAt: deadline ? new Date(deadline).toISOString() : null,
        from,
        to,
      });
      showToast(`Pasalo opened on ${result.opened} counter(s). `
        + `${result.skippedEmpty} empty and ${result.skippedFull} full were left alone.`
        + (result.skippedOutOfRange > 0
          ? ` ${result.skippedOutOfRange} from another batch were not touched.`
          : ''));
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open Pasalo.');
    } finally {
      setBusy(null);
    }
  };

  // The one irreversible button on this page, and it is worded like it. Closing
  // decides every counter and books real refunds, so the confirm names what it
  // will do rather than asking "are you sure?".
  const closeStage = async () => {
    const short = batchBoard.filter((c) => c.neededToQualify > 0);
    const ok = await confirm({
      title: `Close Pasalo and decide ${batchBoard.length} counter(s)?`,
      message: (short.length > 0
        ? `${short.length} counter(s) are still below their minimum and will be cancelled — their lines become refunds `
          + 'and those customers stop being billed for them. Successful products keep shipping. This cannot be undone.'
        : 'Every counter reached its minimum, so all of them proceed to fulfilment and nobody is refunded.')
        // Named before the admin commits, not discovered afterwards. Leaving a
        // counter in the stage is the right call for a batch that is not this
        // one, but a silent skip is a batch nobody ever closes.
        + (strayBoard.length > 0
          ? ` ${strayBoard.length} counter(s) from another batch are outside ${from} – ${to} and will be left running.`
          : ''),
      confirmLabel: 'Close Pasalo & decide',
      cancelLabel: 'Keep it running',
    });
    if (!ok) return;
    setBusy('close');
    try {
      const result = await call('/admin/groupbuys/pasalo/close', { from, to });
      showToast(`${result.fulfilled} product(s) proceeding, ${result.failed} failed. `
        + `${result.refundsWritten} refund(s) recorded — ${php(result.refundTotalPhp)} across ${result.customersOwed} customer(s).`
        + (result.skippedOutOfRange > 0
          ? ` ${result.skippedOutOfRange} counter(s) from another batch were left running.`
          : ''));
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not close Pasalo.');
    } finally {
      setBusy(null);
    }
  };

  const board = data?.board ?? [];
  // The stage holds every counter still running, whatever cycle it came from.
  // Only this batch's are acted on — the rest are shown as a warning so a
  // counter that no close will decide is never simply absent from the screen.
  const batchBoard = board.filter((c) => c.inWindow !== false);
  const strayBoard = board.filter((c) => c.inWindow === false);
  const customers = data?.customers ?? [];
  const outstanding = customers.filter((c) => c.status !== 'refunded');

  return (
    <section aria-labelledby="pasalo-panel" className="rounded-[16px] bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pasalo-panel" className="m-0 font-display text-[18px] font-bold">Pasalo / Bunuan</h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            The last window before anything is refunded. Close the stage to decide the batch.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-semibold text-ink-muted">
            Pasalo deadline (optional)
            <input
              type="datetime-local"
              aria-label="Pasalo deadline"
              className={`${field} mt-1 w-auto`}
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </label>
          <button className={btnBoardAction} disabled={busy !== null} onClick={openStage}>
            {busy === 'open' ? 'Opening…' : 'Open Pasalo'}
          </button>
          {batchBoard.length > 0 && (
            <button className={btnPrimary} disabled={busy !== null} onClick={closeStage}>
              {busy === 'close' ? 'Closing…' : 'Close Pasalo & decide'}
            </button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-ink-muted">Loading…</p>}

      {strayBoard.length > 0 && <StrayCounters counters={strayBoard} from={from} to={to} />}

      {batchBoard.length > 0 && <CurrentBatch board={batchBoard} />}

      {customers.length > 0 && (
        <PasaloResults
          from={from}
          to={to}
          totals={data!.totals}
          customers={customers}
          outstanding={outstanding.length}
          onChanged={refresh}
        />
      )}

      {!isLoading && batchBoard.length === 0 && customers.length === 0 && (
        <p className="m-0 rounded-[12px] border border-dashed border-line bg-surface-mist px-4 py-6 text-center text-[12.5px] text-ink-muted">
          No Pasalo running and no refunds determined in this range. Open the stage after ending Kahati.
        </p>
      )}
    </section>
  );
}

// Counters sitting in Pasalo that this batch will not decide.
//
// Its own block above the table rather than a greyed row inside it: these are
// not part of the batch being closed and printing them among its counters is
// how they get refunded with it. But they cannot be hidden either — closing
// skips them, so without this an admin has a counter that appears on no screen
// and in no close, still holding customers' money.
function StrayCounters({
  counters, from, to,
}: { counters: CounterOutcome[]; from: string; to: string }) {
  return (
    <div className="mb-4 rounded-[12px] border border-warn-fg/30 bg-warn-bg px-4 py-3">
      <p className="m-0 text-[12.5px] font-bold text-warn-fg">
        {counters.length} counter(s) in Pasalo are from another batch
      </p>
      <p className="m-0 mt-1 text-[12px] text-ink-body">
        They started outside {from} – {to}, so closing will leave them running and nobody on them is
        refunded. Switch the date range above to the batch they belong to and close that one separately.
      </p>
      <ul className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 p-0 pl-4 text-[12px] text-ink-body">
        {counters.map((c) => (
          <li key={c.groupBuyId}>
            {c.productName} <span className="text-ink-muted">({c.combinedVials}/{c.minRequired})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The table the client asked for, with the two quantity figures stated apart.
// "Needed" is the gap to the MINIMUM and "Slots" the gap to the full box — at
// 5/10 that is 2 and 5, and one column saying "5 more needed" describes a batch
// as two and a half times further from happening than it is.
function CurrentBatch({ board }: { board: CounterOutcome[] }) {
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">Current batch</h3>
      <div className="overflow-x-auto rounded-[12px] border border-line-soft">
        <table className="w-full min-w-[820px] text-left">
          <thead className="border-b border-line-soft bg-surface-mist">
            <tr>
              <th className={headCell}>Product</th>
              <th className={headCell}>Kahati</th>
              <th className={headCell}>Pasalo</th>
              <th className={headCell}>Combined</th>
              <th className={headCell}>Payment&nbsp;confirmed</th>
              <th className={headCell}>Needed to qualify</th>
              <th className={headCell}>Slots remaining</th>
              <th className={headCell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {board.map((c) => {
              const secured = c.neededToQualify === 0;
              // Vials are counted at CHECKOUT, before anyone verifies a peso.
              // A counter qualifying on money nobody has checked is not wrong,
              // but the admin about to order from a supplier deserves to see it.
              const unverified = c.combinedVials - c.paymentConfirmedVials;
              return (
                <tr key={c.groupBuyId} className="border-b border-line-soft/60 last:border-0">
                  <td className={`${cell} font-semibold text-ink`}>{c.productName}</td>
                  <td className={cell}>{c.kahatiVials}</td>
                  <td className={cell}>{c.pasaloVials}</td>
                  <td className={`${cell} font-bold`}>{c.combinedVials}/{c.maxVials}</td>
                  <td className={cell}>
                    {c.paymentConfirmedVials}
                    {unverified > 0 && (
                      <span className="ml-1 text-[11px] text-warn-fg">({unverified} unverified)</span>
                    )}
                  </td>
                  <td className={`${cell} font-bold ${secured ? 'text-ink-faint' : 'text-warn-fg'}`}>
                    {c.neededToQualify}
                  </td>
                  <td className={cell}>{c.slotsRemaining}</td>
                  <td className={cell}>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                      c.slotsRemaining === 0 ? 'bg-line text-ink-body'
                        : secured ? 'bg-[#e8f5db] text-brand-greendark'
                          : 'bg-warn-bg text-warn-fg'}`}>
                      {c.slotsRemaining === 0 ? 'FULL' : secured ? 'QUALIFIED' : 'PASALO OPEN'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PasaloResults({
  from, to, totals, customers, outstanding, onChanged,
}: {
  from: string; to: string; totals: BatchTotals;
  customers: CustomerRefundRow[]; outstanding: number; onChanged: () => void;
}) {
  const showToast = useToast((s) => s.show);
  const [batchLabel, setBatchLabel] = useState('');

  // A plain link rather than a fetch-and-blob: the workbook is built and
  // streamed by the server, the session cookie rides along, and the browser
  // saves it. Nothing about the file is assembled on this page, which is what
  // makes the numbers in it reproducible.
  const exportHref = `/api/admin/report/pasalo-refund/xlsx${qs({ from, to, batchLabel: batchLabel || undefined })}`;

  return (
    <div>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">Pasalo results</h3>

      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-[12px] border border-line-soft bg-surface-mist px-4 py-3 sm:grid-cols-4">
        <Figure label="Successful products" value={String(totals.successfulProducts)} tone="text-brand-greendark" />
        <Figure label="Failed products" value={String(totals.failedProducts)} tone="text-[#b23b3b]" />
        <Figure label="Customers to refund" value={String(totals.customersRequiringRefund)} />
        <Figure label="Total to refund" value={php(totals.refundValuePhp)} tone="text-[#b23b3b]" />
      </dl>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-semibold text-ink-muted">
          Batch name for the file
          <input
            className={`${field} mt-1 w-auto`}
            placeholder="e.g. Batch 7"
            aria-label="Batch name for the file"
            value={batchLabel}
            onChange={(e) => setBatchLabel(e.target.value)}
          />
        </label>
        <a className={btnPrimary} href={exportHref} download>Export Refund Excel</a>
        {outstanding > 0 && (
          <span className="text-[12px] text-ink-muted">
            {outstanding} customer(s) still to pay. Downloading marks nothing as refunded.
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-[12px] border border-line-soft">
        <table className="w-full min-w-[900px] text-left">
          <thead className="border-b border-line-soft bg-surface-mist">
            <tr>
              <th className={headCell}>Customer</th>
              <th className={headCell}>Orders</th>
              <th className={headCell}>Failed items</th>
              <th className={headCell}>Successful</th>
              <th className={headCell}>Goods refund</th>
              <th className={headCell}>Deposit refund</th>
              <th className={headCell}>Total to refund</th>
              <th className={headCell}>Status</th>
              <th className={headCell} />
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <CustomerRow key={c.userId} c={c} onChanged={onChanged} onError={showToast} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerRow({
  c, onChanged, onError,
}: { c: CustomerRefundRow; onChanged: () => void; onError: (m: string) => void }) {
  const [reference, setReference] = useState('');
  const settled = c.status === 'refunded';

  return (
    <tr className="border-b border-line-soft/60 last:border-0">
      <td className={cell}>
        <div className="font-semibold text-ink">{c.customerName}</div>
        <div className="text-[11px] text-ink-muted">{c.customerPhone || c.customerEmail}</div>
      </td>
      <td className={`${cell} whitespace-nowrap`}>{c.orderNos}</td>
      <td className={cell}>{c.failedItems}</td>
      <td className={`${cell} text-brand-greendark`}>{php(c.successfulPhp)}</td>
      <td className={cell}>{php(c.goodsRefundPhp)}</td>
      <td className={cell}>{php(c.depositRefundPhp)}</td>
      <td className={`${cell} font-bold text-ink`}>{php(c.totalRefundPhp)}</td>
      <td className={cell}>
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${REFUND_STATUS_BADGE[c.status as RefundStatus]}`}>
          {REFUND_STATUS_LABEL[c.status as RefundStatus]}
        </span>
      </td>
      <td className={cell}>
        {settled ? (
          <span className="text-[11px] text-ink-muted">{c.reference || '—'}</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              className={`${field} w-[130px]`}
              placeholder="Reference"
              aria-label={`Payment reference for ${c.customerName}`}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <MarkPaidButton
              customer={c}
              reference={reference}
              onChanged={onChanged}
              onError={onError}
            />
          </div>
        )}
      </td>
    </tr>
  );
}

// Its own component so the PATCH-per-line loop stays out of the row's render
// path. Every failed line of this customer is settled with the same reference,
// because it is one transfer; a line the server refuses (already refunded) is
// counted and reported rather than aborting the rest.
function MarkPaidButton({
  customer, reference, onChanged, onError,
}: {
  customer: CustomerRefundRow; reference: string;
  onChanged: () => void; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const showToast = useToast((s) => s.show);

  const run = async () => {
    if (!reference.trim()) { onError('Enter the payment reference first.'); return; }
    setBusy(true);
    let settled = 0;
    const refused: string[] = [];
    try {
      for (const refundId of customer.refundIds) {
        const res = await fetch(`/api/admin/refunds/${refundId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'refunded', reference: reference.trim() }),
        });
        if (res.ok) settled += 1;
        else refused.push((await res.json())?.error ?? 'refused');
      }
      showToast(refused.length
        ? `${settled} line(s) marked refunded. ${refused.length} were refused — reload and check.`
        : `${customer.customerName} marked refunded (${settled} line(s)).`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not record the refund.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className={btnGhost} disabled={busy} onClick={run}>
      {busy ? 'Saving…' : 'Mark refunded'}
    </button>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={`m-0 mt-0.5 font-display text-[17px] font-bold ${tone ?? 'text-ink'}`}>{value}</dd>
    </div>
  );
}
