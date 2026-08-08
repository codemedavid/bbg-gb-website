import { randomUUID } from 'node:crypto';
import { putFile } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { ApiError } from '@/lib/session';

export const MAX_PROOF_BYTES = 8 * 1024 * 1024;
export const PROOF_TYPES = /^(image\/(jpe?g|png|webp|heic)|application\/pdf)$/;

// How many proofs one order may carry.
//
// Banks cap a single transfer, so a ₱4,500 order is often paid in three: the
// customer ends up with three screenshots and, until now, one slot. Five is the
// client's number and it is generous — it exists so nobody has to choose which
// of their own payments to leave unevidenced.
export const MAX_PROOFS = 5;

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
): Promise<string[]> {
  const attached = entries.filter(isAttached);
  if (attached.length === 0) {
    throw new ApiError(400, 'Payment proof is required to place an order.');
  }
  if (attached.length > MAX_PROOFS) {
    throw new ApiError(400, `You can attach up to ${MAX_PROOFS} payment proofs — ${attached.length} were submitted.`);
  }
  for (const proof of attached) validate(proof);

  // Sequential rather than Promise.all: the keys must come back in submission
  // order so "Proof #2" means the same file to the customer and to the admin.
  const keys: string[] = [];
  for (const proof of attached) keys.push(await store(proof));
  return keys;
}

/**
 * Single-proof form, kept for the settlement flow, which still takes one.
 *
 * Delegates so both paths share one set of size and type rules — a settlement
 * proof and an order proof are the same screenshot of the same bank app.
 */
export async function validateAndStoreProof(proof: FormDataEntryValue | null): Promise<string> {
  const [key] = await validateAndStoreProofs(proof ? [proof] : []);
  return key;
}
