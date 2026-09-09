'use client';
import { useState } from 'react';
import { useAdminCoaFiles, useAdminProducts, useMutate } from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { shortDate } from '@/lib/format';
import type { PublicCoaFile } from '@/lib/types';

// Upload only, no edit. The document IS the certificate: a wrong file is deleted
// and re-uploaded, which is one action fewer than a form that could silently swap
// the lab sheet under a batch label somebody already read.
function UploadForm({ onClose }: { onClose: () => void }) {
  const { saveCoaFile } = useMutate();
  const { data: products = [] } = useAdminProducts();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [label, setLabel] = useState('');
  const [batch, setBatch] = useState('');
  const [productId, setProductId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  };

  const submit = async () => {
    if (!file) { setError('Please choose the COA image.'); return; }
    const body = new FormData();
    body.set('file', file);
    body.set('label', label.trim());
    body.set('batch', batch.trim());
    body.set('productId', productId);
    // Surfaced inside the form rather than closing on failure — the same reason
    // the feedback and payment-method forms do it.
    try {
      await saveCoaFile.mutateAsync(body);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the COA.');
    }
  };

  return (
    <Modal title="Upload COA" onClose={onClose}>
      {/* Said before the upload, not after. A COA names the lab, the batch and
          sometimes the buyer who paid for the test, and this gallery is public. */}
      <p className="mb-3 rounded-[10px] bg-[#fff6e5] px-3 py-2 text-[12.5px] leading-relaxed text-[#8a5a00]">
        ⚠️ This gallery is <strong>public</strong> — anyone can open it without logging in. Crop out anything on
        the sheet that is not the lab result itself.
      </p>

      <div>
        <span className="mb-1 block text-[12px] font-semibold text-ink-body">Certificate image</span>
        <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border-[1.5px] border-dashed border-[#a9c88f] bg-[#fbfdf9] p-3">
          <input type="file" accept="image/*" aria-label="Certificate image" onChange={onFile} className="hidden" />
          {preview
            ? <img src={preview} alt="COA preview" className="h-24 w-20 rounded-lg object-cover" />
            : <div className="grid h-24 w-20 place-items-center rounded-lg bg-surface-mist text-2xl">🔬</div>}
          <div className="text-[12.5px] font-semibold text-brand-greendark">
            {preview ? 'Tap to replace' : 'Upload COA image'}
            <span className="mt-0.5 block font-normal text-ink-muted">JPG, PNG, WebP or HEIC · max 5MB</span>
          </div>
        </label>
      </div>

      <div className="mt-3">
        <Labeled label="Label (optional)">
          <input className={field} maxLength={200} value={label}
            placeholder="e.g. Retatrutide 10mg — Sept batch"
            onChange={(e) => setLabel(e.target.value)} />
        </Labeled>
        <span className="mt-0.5 block text-[12px] text-ink-muted">
          Left blank, the certificate is listed under the uploaded file&apos;s name.
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Labeled label="Batch (optional)">
          <input className={field} maxLength={40} value={batch} placeholder="e.g. A24"
            onChange={(e) => setBatch(e.target.value)} />
        </Labeled>
        <Labeled label="Product (optional)">
          <select className={field} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">— Not tied to a product —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Labeled>
      </div>

      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saveCoaFile.isPending} onClick={submit}>
          {saveCoaFile.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </Modal>
  );
}

export default function AdminCoaPage() {
  const { data: files = [], isLoading } = useAdminCoaFiles();
  const { deleteCoaFile } = useMutate();
  const confirm = useConfirm();
  const [uploading, setUploading] = useState(false);

  const handleDelete = async (c: PublicCoaFile) => {
    const ok = await confirm({
      title: `Delete "${c.label}"?`,
      message: 'The certificate comes off the public COA page immediately. This cannot be undone.',
      confirmLabel: 'Delete COA',
    });
    if (ok) deleteCoaFile.mutate(c.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">COA — Lab Results</h1>
          <p className="mt-1 max-w-[640px] text-[13px] text-ink-muted">
            Third-party lab certificates. Customers browse them at /coa — reachable from the home page, under
            Customer feedback — and every file opens on this site, never on ImageKit.
          </p>
        </div>
        <button className={btnPrimary} onClick={() => setUploading(true)}>+ Upload COA</button>
      </div>

      {files.length === 0 && !isLoading ? (
        <p className="rounded-[12px] bg-white px-4 py-10 text-center text-[13px] text-ink-muted shadow-card">
          Wala pang COA na na-upload.
        </p>
      ) : (
        <ul aria-label="Certificates of analysis" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {isLoading && <li className="text-[13px] text-ink-muted">Loading…</li>}
          {files.map((c) => (
            <li key={c.id} className="overflow-hidden rounded-[14px] bg-white shadow-card">
              <a href={c.fileUrl} target="_blank" rel="noreferrer noopener"
                className="block aspect-[4/5] bg-surface-mist" aria-label={`Open ${c.label}`}>
                {c.isImage
                  ? <img src={c.fileUrl} alt={c.label} loading="lazy" className="h-full w-full object-cover" />
                  : <span className="grid h-full w-full place-items-center text-[30px] opacity-50" aria-hidden>📄</span>}
              </a>
              <div className="flex flex-col gap-1 p-2.5">
                <span className="text-[12.5px] font-semibold leading-snug text-ink">{c.label}</span>
                {c.batch && <span className="text-[11.5px] text-ink-muted">Batch {c.batch}</span>}
                {c.productName && <span className="text-[11.5px] text-ink-muted">{c.productName}</span>}
                <span className="text-[11px] text-ink-muted">{shortDate(c.uploadedAt)}</span>
                <button className="mt-1 w-fit text-[12.5px] font-semibold text-[#b23b3b]"
                  onClick={() => handleDelete(c)} aria-label={`Delete ${c.label}`}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {uploading && <UploadForm onClose={() => setUploading(false)} />}
    </div>
  );
}
