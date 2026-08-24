'use client';
import { useState } from 'react';
import { useAdminPaymentMethods, useMutate } from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import { useConfirm } from '@/components/ConfirmDialog';
import type { PaymentMethod } from '@/lib/types';
import { DEFAULT_PAYMENT_PURPOSE, type PaymentPurpose } from '@/lib/payment-purpose';
import { KahatiDownpaymentCard } from './KahatiDownpaymentCard';

const blank = (purpose: PaymentPurpose): Partial<PaymentMethod> =>
  ({ label: '', accountName: '', accountNumber: '', instructions: null, purpose, isActive: true, sortOrder: 0, qrUrl: null });

function MethodForm({ initial, onClose }: { initial: Partial<PaymentMethod>; onClose: () => void }) {
  const { savePaymentMethod } = useMutate();
  const [f, setF] = useState<Partial<PaymentMethod>>(initial);
  const [qr, setQr] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>(initial.qrUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const isDownpayment = f.purpose === 'kahati_downpayment';

  const onQr = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setQr(file);
    setPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!f.label || !f.accountName || !f.accountNumber) { setError('Label, account name and number are required.'); return; }
    // A brand-new method must ship with a QR — there is no existing image to fall back on.
    if (!f.id && !qr) { setError('Please upload a QR image for this payment method.'); return; }
    const body = new FormData();
    body.set('label', f.label);
    body.set('accountName', f.accountName);
    body.set('accountNumber', f.accountNumber);
    body.set('purpose', f.purpose ?? DEFAULT_PAYMENT_PURPOSE);
    body.set('instructions', f.instructions ?? '');
    body.set('isActive', String(f.isActive ?? true));
    body.set('sortOrder', String(f.sortOrder ?? 0));
    if (qr) body.set('qr', qr);
    // Surface a rejected save (e.g. the prod 503 when file uploads are not
    // configured) inside the form instead of closing on failure.
    try {
      await savePaymentMethod.mutateAsync({ id: f.id, body });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save payment method.');
    }
  };

  return (
    <Modal title={f.id ? 'Edit payment method' : isDownpayment ? 'New Kahati downpayment method' : 'New payment method'} onClose={onClose}>
      {/* Deliberately editable on an existing method, and deliberately loud
          about it: moving a method between the two lists changes which QR
          customers are shown for an unfilled kit. */}
      <div className="mb-3">
        <span className="mb-1 block text-[12px] font-semibold text-ink-body">This method collects</span>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'full' as const, title: 'Full payment', hint: 'On-hand, Group Buy, MOQ & final balances' },
            { value: 'kahati_downpayment' as const, title: 'Kahati downpayment', hint: 'Deposits on kits still filling' },
          ]).map((p) => {
            const active = (f.purpose ?? DEFAULT_PAYMENT_PURPOSE) === p.value;
            return (
              <label key={p.value}
                className={`cursor-pointer rounded-[12px] border-[1.5px] px-3 py-2.5 transition-colors ${active ? 'border-brand-green bg-[#f2f8ec]' : 'border-line hover:border-[#a9c88f]'}`}>
                <input type="radio" name="purpose" className="sr-only" checked={active}
                  onChange={() => setF({ ...f, purpose: p.value })} />
                <span className="block text-[13px] font-bold text-ink">{p.title}</span>
                <span className="block text-[11.5px] text-ink-muted">{p.hint}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Label (e.g. GCash)"><input className={field} value={f.label || ''} onChange={(e) => setF({ ...f, label: e.target.value })} /></Labeled>
        <Labeled label="Sort order"><input className={field} type="number" value={f.sortOrder ?? 0} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Labeled>
        <Labeled label="Account name"><input className={field} value={f.accountName || ''} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></Labeled>
        <Labeled label="Account / number"><input className={field} value={f.accountNumber || ''} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></Labeled>
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-[12px] font-semibold text-ink-body">
          {isDownpayment ? 'Downpayment QR image' : 'QR image'}
        </span>
        <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border-[1.5px] border-dashed border-[#a9c88f] bg-[#fbfdf9] p-3">
          <input type="file" accept="image/*" onChange={onQr} className="hidden" />
          {preview
            ? <img src={preview} alt="QR preview" className="h-20 w-20 rounded-lg object-contain" />
            : <div className="grid h-20 w-20 place-items-center rounded-lg bg-surface-mist text-2xl">📷</div>}
          <div className="text-[12.5px] font-semibold text-brand-greendark">{preview ? 'Tap to replace QR' : 'Upload QR image'}</div>
        </label>
        {isDownpayment && (
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Upload a QR that is locked to the downpayment amount if your bank supports it — that is what stops a
            customer sending the full order price for a kit that has not filled.
          </p>
        )}
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-[12px] font-semibold text-ink-body">Payment instructions (optional)</span>
        <textarea className={`${field} h-[64px] resize-none`} maxLength={500} value={f.instructions ?? ''}
          placeholder={isDownpayment ? 'e.g. Send exactly the downpayment amount. Put your order number in the message.' : 'e.g. Include your order number in the reference.'}
          onChange={(e) => setF({ ...f, instructions: e.target.value.trim() === '' ? null : e.target.value })} />
        <span className="mt-0.5 block text-[12px] text-ink-muted">Shown under the QR at checkout.</span>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-ink-body">
        <input type="checkbox" checked={!!f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active — show at checkout
      </label>

      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={savePaymentMethod.isPending} onClick={submit}>{savePaymentMethod.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function MethodTable({
  methods, isLoading, emptyNotice, onEdit, onDelete,
}: {
  methods: PaymentMethod[];
  isLoading: boolean;
  emptyNotice: string;
  onEdit: (m: PaymentMethod) => void;
  onDelete: (m: PaymentMethod) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-4 py-3">QR</th><th className="px-4 py-3">Method</th>
            <th className="px-4 py-3">Account</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={5}>Loading…</td></tr> :
            methods.length === 0 ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={5}>{emptyNotice}</td></tr> :
            methods.map((m) => (
              <tr key={m.id} className={`border-b border-line-soft/60 ${!m.isActive ? 'opacity-40' : ''}`}>
                <td className="px-4 py-3">
                  {m.qrUrl
                    ? <img src={m.qrUrl} alt={`${m.label} QR`} className="h-12 w-12 rounded-lg object-contain" />
                    : <span className="text-ink-faint">—</span>}
                </td>
                <td className="px-4 py-3 font-semibold text-ink">
                  {m.label}
                  {m.instructions && <div className="mt-0.5 max-w-[240px] text-[11.5px] font-normal text-ink-muted">{m.instructions}</div>}
                </td>
                <td className="px-4 py-3 text-ink-body">
                  <div>{m.accountName}</div>
                  <div className="text-[11.5px] text-ink-muted">{m.accountNumber}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${m.isActive ? 'bg-[#e8f5db] text-brand-greendark' : 'bg-surface-mist text-ink-muted'}`}>{m.isActive ? 'Active' : 'Hidden'}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onEdit(m)} className="mr-2 font-semibold text-brand-blue">Edit</button>
                  <button onClick={() => onDelete(m)} className="font-semibold text-[#b23b3b]">Delete</button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminPaymentMethodsPage() {
  const { data: methods = [], isLoading } = useAdminPaymentMethods();
  const { deletePaymentMethod } = useMutate();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<PaymentMethod> | null>(null);

  // The one split the whole feature turns on. Rendering them as two sections
  // rather than one list with a badge is deliberate: an admin has to be able to
  // see at a glance that a downpayment QR exists at all, because a configured
  // deposit with no QR behind it blocks every hatian checkout.
  const fullMethods = methods.filter((m) => m.purpose !== 'kahati_downpayment');
  const downpaymentMethods = methods.filter((m) => m.purpose === 'kahati_downpayment');

  const handleDelete = async (m: PaymentMethod) => {
    const ok = await confirm({
      title: `Delete "${m.label}"?`,
      message: 'This payment method will no longer be shown at checkout. This cannot be undone.',
      confirmLabel: 'Delete method',
    });
    if (ok) deletePaymentMethod.mutate(m.id);
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="m-0 font-display text-[24px] font-bold">Payment Methods</h1>
            <p className="mt-1 text-[13px] text-ink-muted">
              Account details &amp; QR shown at checkout for full payments — on-hand, Group Buy, MOQ and
              final hatian balances. {fullMethods.length} methods.
            </p>
          </div>
          <button className={btnPrimary} onClick={() => setEditing(blank('full'))}>+ New method</button>
        </div>
        <MethodTable
          methods={fullMethods} isLoading={isLoading}
          emptyNotice="No payment methods yet. Add GCash, Maya, etc."
          onEdit={setEditing} onDelete={handleDelete}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="m-0 font-display text-[20px] font-bold">Kahati Downpayment Payment Method</h2>
            <p className="mt-1 max-w-[640px] text-[13px] text-ink-muted">
              A separate QR used only while a kahati kit is still filling. Customers see this one — and never the
              full-payment QR — until the kit is complete, so a kit that gets cancelled never has to refund a full order.
            </p>
          </div>
          <button className={btnPrimary} onClick={() => setEditing(blank('kahati_downpayment'))}>+ New downpayment method</button>
        </div>

        {downpaymentMethods.length === 0 && !isLoading && (
          <p className="rounded-[12px] bg-[#fff6e5] px-4 py-3 text-[13px] text-[#8a5a00]">
            ⚠️ No downpayment QR is set up. If you configure a downpayment amount below, kahati checkout will be
            blocked until a QR is added here — customers are never shown the full-payment QR instead.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
          <MethodTable
            methods={downpaymentMethods} isLoading={isLoading}
            emptyNotice="No Kahati downpayment method yet. Add the QR customers should send their deposit to."
            onEdit={setEditing} onDelete={handleDelete}
          />
          <KahatiDownpaymentCard />
        </div>
      </section>

      {editing && <MethodForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
