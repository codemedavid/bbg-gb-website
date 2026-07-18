import { randomUUID } from 'node:crypto';
import { putFile } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { ApiError } from '@/lib/session';

export const MAX_PROOF_BYTES = 8 * 1024 * 1024;
export const PROOF_TYPES = /^(image\/(jpe?g|png|webp|heic)|application\/pdf)$/;

// Validates an uploaded payment proof and stores it, returning the storage key.
// Storing is an external side effect done OUTSIDE any DB transaction: a rolled-back
// order leaves a harmless orphaned object rather than a claimed slot.
export async function validateAndStoreProof(proof: FormDataEntryValue | null): Promise<string> {
  if (!(proof instanceof File) || proof.size === 0) throw new ApiError(400, 'Payment proof is required to place an order.');
  if (proof.size > MAX_PROOF_BYTES) throw new ApiError(400, 'Proof must be 8MB or smaller.');
  if (!PROOF_TYPES.test(proof.type)) throw new ApiError(400, 'Proof must be an image or PDF.');
  const ext = (proof.name.split('.').pop() || 'bin').toLowerCase();
  const key = `${randomUUID()}.${ext}`;
  await putFile(BUCKETS.proofs, key, Buffer.from(await proof.arrayBuffer()), proof.type);
  return key;
}
