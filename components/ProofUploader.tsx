'use client';
// Proof of payment — up to five files, with previews and a way to take one out.
//
// The control this replaces had a single slot and said "tap to replace", which
// is exactly wrong for the customer it was failing: someone whose bank capped a
// transfer at ₱2,000 paid a ₱4,500 order three times and could evidence one of
// them. Attaching is additive here, and the numbering is positional so removing
// the middle one renumbers rather than leaving a gap.
//
// The cap is repeated on the server (lib/proof.ts) — this is the courteous half,
// not the enforcing one.
import { useEffect, useMemo, useState } from 'react';
import { MAX_PROOFS } from '@/lib/proof';

type Props = {
  files: File[];
  onChange: (files: File[]) => void;
  /**
   * Proofs the order already holds, when this control is adding to an existing
   * set rather than starting one. Shifts the numbering and the cap, so a file
   * picked against an order with two filed proofs reads "Proof #3" — and does
   * not put a second "Proof #1" on a screen already showing one.
   */
  startIndex?: number;
};

export function ProofUploader({ files, onChange, startIndex = 0 }: Props) {
  // Rejections are shown, never applied silently. Truncating an over-long
  // selection would tell the customer their last transfer was evidenced.
  const [error, setError] = useState<string | null>(null);
  // Everything counts from the total the ORDER would hold, not from what this
  // control is currently holding.
  const total = startIndex + files.length;
  const isFull = total >= MAX_PROOFS;

  // One object URL per image, rebuilt only when the file list itself changes.
  // PDFs get null — there is nothing to show, and an <img> pointed at one
  // renders as a broken image.
  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)),
    [files],
  );
  // Released when the list changes or the page leaves; each URL pins its blob in
  // memory until it is revoked, and a customer swapping files would leak every
  // one they discarded.
  useEffect(() => () => {
    for (const url of previews) if (url) URL.revokeObjectURL(url);
  }, [previews]);

  const add = (picked: FileList | null) => {
    const added = Array.from(picked ?? []);
    if (added.length === 0) return;
    if (total + added.length > MAX_PROOFS) {
      setError(
        `You can attach up to ${MAX_PROOFS} proofs. Remove one before adding another.`,
      );
      return;
    }
    setError(null);
    onChange([...files, ...added]);
  };

  const removeAt = (index: number) => {
    setError(null);
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-bold text-ink">
          Proof of payment <span className="text-[#d33]">*</span>
        </div>
        <div className="text-[12px] text-ink-muted">
          {total > 0 ? `${total} of ${MAX_PROOFS} attached` : `Upload up to ${MAX_PROOFS} files`}
        </div>
      </div>

      {files.length > 0 && (
        <ul className="mb-2.5 flex flex-col gap-2">
          {files.map((file, i) => (
            // Keyed by position: two screenshots from one bank app can share a
            // name and a size, so nothing else here is reliably unique.
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-3 rounded-[12px] border border-line bg-white px-3 py-2.5"
            >
              {previews[i]
                ? <img src={previews[i]!} alt={`Proof ${startIndex + i + 1} preview`} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                : <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-mist text-xl">📄</span>}
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-bold text-brand-greendark">Proof #{startIndex + i + 1}</div>
                <div className="truncate text-[12px] text-ink-muted">{file.name}</div>
              </div>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove proof ${startIndex + i + 1}`}
                className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-ink-body hover:border-[#d33] hover:text-[#d33]"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {isFull ? (
        <p className="rounded-[12px] bg-surface-mist px-3 py-2.5 text-center text-[12.5px] text-ink-muted">
          You&apos;ve attached the maximum of {MAX_PROOFS} proofs. Remove one to swap it out.
        </p>
      ) : (
        <label className="block cursor-pointer rounded-[12px] border-[1.5px] border-dashed border-[#a9c88f] bg-[#fbfdf9] p-[18px] text-center">
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={(e) => { add(e.target.files); e.target.value = ''; }}
            className="hidden"
          />
          <div className="mb-1.5 text-[26px]">🧾</div>
          <div className="text-[13.5px] font-bold text-ink">
            {total === 0 ? 'Upload payment proof' : 'Add another proof'}
          </div>
          <div className="text-[12px] text-ink-muted">
            Screenshot or photo of each payment — one per transfer
          </div>
        </label>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[12.5px] text-[#a33]">
          {error}
        </p>
      )}
    </div>
  );
}
