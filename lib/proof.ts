import { randomUUID } from 'node:crypto';
import { putFile } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { ApiError } from '@/lib/session';
import { MAX_PROOFS, MAX_PROOF_BYTES, PROOF_TYPES } from '@/lib/proof-limits';

// Re-exported so server callers keep one import, while the browser reaches for
// lib/proof-limits.ts directly — this module pulls in ApiError from the
// `server-only` session module and cannot be in a client bundle.
export { MAX_PROOFS, MAX_PROOF_BYTES, PROOF_TYPES };

// An untouched <input type="file"> still submits an entry, so "did the customer
// attach anything" is a question about size, not presence.
const isAttached = (v: FormDataEntryValue): v is File => v instanceof File && v.size > 0;

function validate(proof: File): void {
  if (proof.size > MAX_PROOF_BYTES) throw new ApiError(400, 'Proof must be 8MB or smaller.');
  if (!PROOF_TYPES.test(proof.type)) throw new ApiError(400, 'Proof must be an image or PDF.');
}

async function store(proof: File): Promise<string> {
  // The extension rides along on the key: the admin opens these in a browser,
  // and an extensionless PDF downloads instead of previewing.
  const ext = (proof.name.split('.').pop() || 'bin').toLowerCase();
  const key = `${randomUUID()}.${ext}`;
  await putFile(BUCKETS.proofs, key, Buffer.from(await proof.arrayBuffer()), proof.type);
  return key;
}

/**
 * Validate a set of uploaded payment proofs and store them, returning their
 * storage keys in the order they were submitted.
 *
 * Storing is an external side effect done OUTSIDE any DB transaction: a
 * rolled-back order leaves harmless orphaned objects rather than a claimed slot.
 *
 * Everything is validated before anything is stored, for two reasons. A batch
 * refused on its count must not leave five orphans behind; and a batch with one
 * bad file among five is refused whole, because accepting the rest would leave
 * the customer believing a proof they can see in their list was filed when it
 * was not.
 *
 * The cap is enforced here and not only by the file input — the count arrives
 * from a multipart body that anyone can hand-build, which is the same reason
 * the channel rules live on the server.
 */
export async function validateAndStoreProofs(
  entries: readonly FormDataEntryValue[],
  opts: {
    /**
     * Proofs the order already carries, for an upload that adds to an existing
     * set rather than starting one. Bank transfers happen hours or days apart,
     * so the cap has to count what was filed on previous visits — otherwise
     * five uploads of one file each slips through five separate checks.
     */
    existingCount?: number;
  } = {},
): Promise<string[]> {
  const existing = opts.existingCount ?? 0;
  const remaining = Math.max(0, MAX_PROOFS - existing);
  const attached = entries.filter(isAttached);
  if (attached.length === 0) {
    throw new ApiError(400, 'Payment proof is required to place an order.');
  }
  if (attached.length > remaining) {
    // Phrased as what is LEFT, not as the total. "Up to 5" is no help to
    // someone holding four already; they need to know they have one.
    throw new ApiError(400, remaining === 0
      ? `This order already has the maximum of ${MAX_PROOFS} payment proofs.`
      : `You can add ${remaining} more payment proof${remaining === 1 ? '' : 's'} — ${attached.length} were submitted.`);
  }
  for (const proof of attached) validate(proof);

  // Sequential rather than Promise.all: the keys must come back in submission
  // order so "Proof #2" means the same file to the customer and to the admin.
  const keys: string[] = [];
  for (const proof of attached) keys.push(await store(proof));
  return keys;
}
