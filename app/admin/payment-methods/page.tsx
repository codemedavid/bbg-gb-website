'use client';
import { useState } from 'react';
import { useAdminPaymentMethods, useMutate } from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import type { PaymentMethod } from '@/lib/types';

const blank = (): Partial<PaymentMethod> => ({ label: '', accountName: '', accountNumber: '', isActive: true, sortOrder: 0, qrUrl: null });

function MethodForm({ initial, onClose }: { initial: Partial<PaymentMethod>; onClose: () => void }) {
  const { savePaymentMethod } = useMutate();
  const [f, setF] = useState<Partial<PaymentMethod>>(initial);
  const [qr, setQr] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>(initial.qrUrl ?? '');
  const [error, setError] = useState<string | null>(null);

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
    <Modal title={f.id ? 'Edit payment method' : 'New payment method'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Label (e.g. GCash)"><input className={field} value={f.label || ''} onChange={(e) => setF({ ...f, label: e.target.value })} /></Labeled>
        <Labeled label="Sort order"><input className={field} type="number" value={f.sortOrder ?? 0} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Labeled>
        <Labeled label="Account name"><input className={field} value={f.accountName || ''} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></Labeled>
        <Labeled label="Account / number"><input className={field} value={f.accountNumber || ''} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></Labeled>
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-[12px] font-semibold text-ink-body">QR image</span>
        <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border-[1.5px] border-dashed border-[#a9c88f] bg-[#fbfdf9] p-3">
          <input type="file" accept="image/*" onChange={onQr} className="hidden" />
          {preview
            ? <img src={preview} alt="QR preview" className="h-20 w-20 rounded-lg object-contain" />
            : <div className="grid h-20 w-20 place-items-center rounded-lg bg-surface-mist text-2xl">📷</div>}
          <div className="text-[12.5px] font-semibold text-brand-greendark">{preview ? 'Tap to replace QR' : 'Upload QR image'}</div>
        </label>
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

export default function AdminPaymentMethodsPage() {
  const { data: methods = [], isLoading } = useAdminPaymentMethods();
  const { deletePaymentMethod } = useMutate();
  const [editing, setEditing] = useState<Partial<PaymentMethod> | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Payment Methods</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Account details &amp; QR shown at checkout. {methods.length} methods.</p>
        </div>
        <button className={btnPrimary} onClick={() => setEditing(blank())}>+ New method</button>
      </div>

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
              methods.length === 0 ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={5}>No payment methods yet. Add GCash, Maya, etc.</td></tr> :
              methods.map((m) => (
                <tr key={m.id} className={`border-b border-line-soft/60 ${!m.isActive ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-3">
                    {m.qrUrl
                      ? <img src={m.qrUrl} alt={`${m.label} QR`} className="h-12 w-12 rounded-lg object-contain" />
                      : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-ink">{m.label}</td>
                  <td className="px-4 py-3 text-ink-body">
                    <div>{m.accountName}</div>
                    <div className="text-[11.5px] text-ink-muted">{m.accountNumber}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${m.isActive ? 'bg-[#e8f5db] text-brand-greendark' : 'bg-surface-mist text-ink-muted'}`}>{m.isActive ? 'Active' : 'Hidden'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(m)} className="mr-2 font-semibold text-brand-blue">Edit</button>
                    <button onClick={() => deletePaymentMethod.mutate(m.id)} className="font-semibold text-[#b23b3b]">Delete</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {editing && <MethodForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
