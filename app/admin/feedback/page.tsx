'use client';
import { useState } from 'react';
import {
  useAdminFeedbackFolders, useAdminFeedbackFolder, useMutate, type FeedbackFolderPayload,
} from '@/lib/admin-api';
import { Modal, field, Labeled, btnPrimary, btnGhost } from '@/components/admin-ui';
import { useConfirm } from '@/components/ConfirmDialog';
import type { FeedbackFolder, FeedbackItem } from '@/lib/types';

const blankFolder = (): Partial<FeedbackFolder> =>
  ({ name: '', description: null, isActive: true, sortOrder: 0 });

const blankItem = (folderId: string): Partial<FeedbackItem> =>
  ({ folderId, caption: null, customerName: null, isActive: true, sortOrder: 0 });

function FolderForm({ initial, onClose }: { initial: Partial<FeedbackFolder>; onClose: () => void }) {
  const { saveFeedbackFolder } = useMutate();
  const [f, setF] = useState<Partial<FeedbackFolder>>(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!f.name?.trim()) { setError('Please give the folder a name.'); return; }
    const payload: FeedbackFolderPayload = {
      name: f.name.trim(),
      description: f.description?.trim() || null,
      isActive: f.isActive ?? true,
      sortOrder: f.sortOrder ?? 0,
    };
    // Surface a rejected save inside the form instead of closing on failure —
    // the same reason the payment-method form does.
    try {
      await saveFeedbackFolder.mutateAsync({ id: f.id, body: payload });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the folder.');
    }
  };

  return (
    <Modal title={f.id ? 'Edit folder' : 'New folder'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Folder name">
          <input className={field} value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Labeled>
        <Labeled label="Sort order">
          <input className={field} type="number" value={f.sortOrder ?? 0}
            onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} />
        </Labeled>
      </div>

      <div className="mt-3">
        <Labeled label="Description (optional)">
          <input className={field} maxLength={300} value={f.description ?? ''}
            placeholder="e.g. August batch, GLP-1 orders"
            onChange={(e) => setF({ ...f, description: e.target.value.trim() === '' ? null : e.target.value })} />
        </Labeled>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-ink-body">
        <input type="checkbox" checked={!!f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        Active — show on the storefront
      </label>

      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saveFeedbackFolder.isPending} onClick={submit}>
          {saveFeedbackFolder.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

function ItemForm({ initial, onClose }: { initial: Partial<FeedbackItem>; onClose: () => void }) {
  const { saveFeedbackItem } = useMutate();
  const [f, setF] = useState<Partial<FeedbackItem>>(initial);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>(initial.imageUrl ?? '');
  const [error, setError] = useState<string | null>(null);

  const onImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImage(file);
    setPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    // A new feedback must ship with a screenshot — there is no existing image
    // to fall back on, and the screenshot IS the feedback.
    if (!f.id && !image) { setError('Please upload the feedback screenshot.'); return; }
    const body = new FormData();
    body.set('folderId', String(f.folderId));
    body.set('caption', f.caption ?? '');
    body.set('customerName', f.customerName ?? '');
    body.set('isActive', String(f.isActive ?? true));
    body.set('sortOrder', String(f.sortOrder ?? 0));
    if (image) body.set('image', image);
    try {
      await saveFeedbackItem.mutateAsync({ id: f.id, body });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the feedback.');
    }
  };

  return (
    <Modal title={f.id ? 'Edit feedback' : 'Upload feedback'} onClose={onClose}>
      {/* Said before anything is uploaded, not after. These are screenshots of
          real conversations and this page is public — a name or a phone number
          left in the frame goes onto the open internet. */}
      <p className="mb-3 rounded-[10px] bg-[#fff6e5] px-3 py-2 text-[12.5px] leading-relaxed text-[#8a5a00]">
        ⚠️ This gallery is <strong>public</strong>. Crop or blur phone numbers, full names and profile photos
        before uploading — anything left in the screenshot is visible to everyone.
      </p>

      <div>
        <span className="mb-1 block text-[12px] font-semibold text-ink-body">Screenshot</span>
        <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border-[1.5px] border-dashed border-[#a9c88f] bg-[#fbfdf9] p-3">
          <input type="file" accept="image/*" aria-label="Screenshot" onChange={onImage} className="hidden" />
          {preview
            ? <img src={preview} alt="Feedback preview" className="h-24 w-20 rounded-lg object-cover" />
            : <div className="grid h-24 w-20 place-items-center rounded-lg bg-surface-mist text-2xl">🖼️</div>}
          <div className="text-[12.5px] font-semibold text-brand-greendark">
            {preview ? 'Tap to replace screenshot' : 'Upload screenshot'}
          </div>
        </label>
      </div>

      <div className="mt-3">
        <Labeled label="What they said (optional)">
          <textarea className={`${field} h-[64px] resize-none`} maxLength={500} value={f.caption ?? ''}
            placeholder="e.g. Sobrang bilis dumating, salamat!"
            onChange={(e) => setF({ ...f, caption: e.target.value.trim() === '' ? null : e.target.value })} />
        </Labeled>
        <span className="mt-0.5 block text-[12px] text-ink-muted">
          Typed out so it is readable on a phone — a chat screenshot alone is too small to read.
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Labeled label="Credit (optional)">
          <input className={field} maxLength={80} value={f.customerName ?? ''}
            placeholder="e.g. Ate Jen, Cavite"
            onChange={(e) => setF({ ...f, customerName: e.target.value.trim() === '' ? null : e.target.value })} />
        </Labeled>
        <Labeled label="Sort order">
          <input className={field} type="number" value={f.sortOrder ?? 0}
            onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} />
        </Labeled>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-ink-body">
        <input type="checkbox" checked={!!f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        Active — show on the storefront
      </label>

      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saveFeedbackItem.isPending} onClick={submit}>
          {saveFeedbackItem.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

export default function AdminFeedbackPage() {
  const { data: folders = [], isLoading } = useAdminFeedbackFolders();
  const { deleteFeedbackFolder, deleteFeedbackItem } = useMutate();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<Partial<FeedbackFolder> | null>(null);
  const [editingItem, setEditingItem] = useState<Partial<FeedbackItem> | null>(null);

  // Falls back to the first folder so the right-hand pane is never blank on
  // arrival, but only once folders have loaded.
  const activeId = selectedId ?? folders[0]?.id ?? null;
  const { data: folder } = useAdminFeedbackFolder(activeId);
  const items = folder?.items ?? [];

  const handleDeleteFolder = async (f: FeedbackFolder) => {
    const ok = await confirm({
      title: `Delete "${f.name}"?`,
      // The count is the point. Deleting a folder cascades to its screenshots,
      // and an admin tidying up a label must not destroy forty testimonials
      // without being told the number first.
      message: f.itemCount > 0
        ? `${f.itemCount} feedback screenshot${f.itemCount === 1 ? '' : 's'} inside will be permanently deleted too. To take the folder off the storefront without losing anything, edit it and untick Active instead.`
        : 'This folder is empty. This cannot be undone.',
      confirmLabel: 'Delete folder',
    });
    if (!ok) return;
    if (f.id === activeId) setSelectedId(null);
    deleteFeedbackFolder.mutate(f.id);
  };

  const handleDeleteItem = async (item: FeedbackItem) => {
    const ok = await confirm({
      title: 'Delete this feedback?',
      message: 'The screenshot will be permanently removed from the storefront. This cannot be undone.',
      confirmLabel: 'Delete feedback',
    });
    if (ok) deleteFeedbackItem.mutate(item.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="m-0 font-display text-[24px] font-bold">Customer Feedback</h1>
          <p className="mt-1 max-w-[640px] text-[13px] text-ink-muted">
            Screenshots of what customers said, filed into folders. Customers browse the folders at
            /feedback — reachable from the home page, under the Order calculator.
          </p>
        </div>
        <button className={btnPrimary} onClick={() => setEditingFolder(blankFolder())}>+ New folder</button>
      </div>

      {folders.length === 0 && !isLoading ? (
        <p className="rounded-[12px] bg-white px-4 py-10 text-center text-[13px] text-ink-muted shadow-card">
          Gumawa muna ng folder bago mag-upload ng feedback.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr] lg:items-start">
          <ul aria-label="Feedback folders" className="flex flex-col gap-2">
            {isLoading && <li className="text-[13px] text-ink-muted">Loading…</li>}
            {folders.map((f) => {
              const active = f.id === activeId;
              return (
                <li key={f.id}
                  className={`rounded-[14px] bg-white p-3.5 shadow-card ${active ? 'ring-2 ring-brand-green' : ''}`}>
                  <button onClick={() => setSelectedId(f.id)} className="w-full text-left">
                    <span className="flex items-center gap-2">
                      <span className="font-display text-[15px] font-bold text-ink">{f.name}</span>
                      {!f.isActive && (
                        <span className="rounded bg-surface-mist px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-muted">Hidden</span>
                      )}
                    </span>
                    {f.description && <span className="mt-0.5 block text-[12px] text-ink-muted">{f.description}</span>}
                    <span className="mt-1 block text-[12px] text-ink-muted">
                      {f.itemCount} feedback{f.itemCount === 1 ? '' : 's'}
                    </span>
                  </button>
                  <div className="mt-2 flex gap-3 text-[12.5px] font-semibold">
                    <button className="text-brand-blue" onClick={() => setEditingFolder(f)}>Edit</button>
                    <button className="text-[#b23b3b]" onClick={() => handleDeleteFolder(f)}
                      aria-label={`Delete folder ${f.name}`}>Delete folder</button>
                  </div>
                </li>
              );
            })}
          </ul>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="m-0 font-display text-[18px] font-bold">{folder?.name ?? 'Feedback'}</h2>
              <button className={btnPrimary} disabled={!activeId}
                onClick={() => activeId && setEditingItem(blankItem(activeId))}>+ Upload feedback</button>
            </div>

            {items.length === 0 ? (
              <p className="rounded-[12px] bg-white px-4 py-10 text-center text-[13px] text-ink-muted shadow-card">
                Wala pang feedback sa folder na ito.
              </p>
            ) : (
              <ul aria-label="Feedback in this folder" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {items.map((item) => (
                  <li key={item.id}
                    className={`overflow-hidden rounded-[14px] bg-white shadow-card ${item.isActive ? '' : 'opacity-50'}`}>
                    <div className="aspect-[3/4] bg-surface-mist">
                      <img src={item.imageUrl} alt={item.caption ?? 'Customer feedback'} loading="lazy"
                        className="h-full w-full object-cover" />
                    </div>
                    <div className="flex flex-col gap-1 p-2.5">
                      {item.caption && <span className="text-[12.5px] font-semibold leading-snug text-ink">{item.caption}</span>}
                      {item.customerName && <span className="text-[11.5px] text-ink-muted">— {item.customerName}</span>}
                      {!item.isActive && (
                        <span className="w-fit rounded bg-surface-mist px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-muted">Hidden</span>
                      )}
                      <div className="mt-1 flex gap-3 text-[12.5px] font-semibold">
                        <button className="text-brand-blue" onClick={() => setEditingItem(item)}
                          aria-label="Edit feedback">Edit</button>
                        <button className="text-[#b23b3b]" onClick={() => handleDeleteItem(item)}
                          aria-label="Delete feedback">Delete</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {editingFolder && <FolderForm initial={editingFolder} onClose={() => setEditingFolder(null)} />}
      {editingItem && <ItemForm initial={editingItem} onClose={() => setEditingItem(null)} />}
    </div>
  );
}
