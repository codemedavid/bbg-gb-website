'use client';
// The customer's own record of what they have paid, and the way to add more.
//
// Uploading every proof at checkout only works for someone who made every
// transfer before checking out. A bank that caps each transfer at ₱2,000 turns
// a ₱4,500 order into three payments spread over hours or days, so this screen
// exists to take the ones that did not exist yet when the order was placed.
//
// Two jobs, and the first matters as much as the second: showing what already
// landed. A customer who cannot see last night's upload has no way to tell
// whether it worked, and their only recourse is to place a second order.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ProofUploader } from '@/components/ProofUploader';
import { MAX_PROOFS } from '@/lib/proof';
import { acceptsMoreProofs } from '@/lib/order-status';
import { php } from '@/lib/format';
import type { PaymentProof } from '@/lib/types';

type Props = {
  orderId: string;
  status: string;
  proofs: PaymentProof[];
};

export function OrderProofSection({ orderId, status, proofs }: Props) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const remaining = MAX_PROOFS - proofs.length;
  // Both conditions, and both are also enforced by the route: the screen only
  // decides whether to ask.
  const canAdd = acceptsMoreProofs(status) && remaining > 0;

  const submit = async () => {
    if (picked.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const file of picked) fd.append('proof', file);
      const res = await fetch(`/api/orders/${orderId}/proofs`, {
        method: 'POST', body: fd, credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        // The server's wording, not a generic one: its refusal is the only
        // message that knows how many slots are actually left.
        setError(json.error || 'Could not add the proof. Please try again.');
        // Deliberately keeps `picked` — making the customer re-pick files they
        // already chose is a second failure on top of the first.
        return;
      }
      setPicked([]);
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch {
      setError('Could not add the proof. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-[12px] font-semibold text-ink-body">Proof of payment</div>
        {/* Only when the uploader is absent — it reports the same count itself,
            and two counters on one card disagree the moment a file is picked. */}
        {proofs.length > 0 && !canAdd && (
          <div className="text-[11.5px] text-ink-muted">{proofs.length} of {MAX_PROOFS} attached</div>
        )}
      </div>

      {proofs.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2.5">
          {proofs.map((proof, i) => (
            <li key={proof.id}>
              <a
                href={proof.url} target="_blank" rel="noopener noreferrer"
                className="block w-[96px] overflow-hidden rounded-[10px] border border-line hover:border-brand-greendark"
              >
                <img src={proof.url} alt="" className="h-[96px] w-full bg-surface-mist object-cover" />
                <span className="block px-2 py-1.5 text-[11.5px] font-bold text-brand-greendark">
                  Proof #{i + 1}
                  {proof.amountPhp ? <span className="block font-normal text-ink-muted">{php(Number(proof.amountPhp))}</span> : null}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-[13px] text-ink-muted">No proof of payment attached yet.</p>
      )}

      {canAdd && (
        <div className="rounded-[12px] border border-line-soft bg-[#fbfbfa] p-3">
          {/* Says why before it says how. Without a reason this control reads as
              "we lost your proof" rather than "you may have paid in parts". */}
          <p className="mb-2.5 text-[12.5px] leading-snug text-ink-muted">
            Paid in several transfers? Add a screenshot for each one — up to {MAX_PROOFS} in total.
          </p>
          {/* Numbered from what the order already holds, so a picked file reads
              "Proof #3" rather than putting a second "Proof #1" on this card. */}
          <ProofUploader
            files={picked}
            startIndex={proofs.length}
            onChange={(files) => { setPicked(files); setError(null); }}
          />
          {picked.length > 0 && (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="mt-2.5 w-full rounded-[10px] bg-brand-greendark px-3 py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
            >
              {submitting ? 'Adding…' : `Add proof${picked.length > 1 ? 's' : ''}`}
            </button>
          )}
          {error && (
            <p role="alert" className="mt-2 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[12.5px] text-[#a33]">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
